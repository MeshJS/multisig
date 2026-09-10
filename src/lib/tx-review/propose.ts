import type { Prisma } from "@prisma/client";

import type { McpToolResult, ToolContext } from "@/lib/mcp/tools";
import { audit } from "@/lib/observability/audit";
import { issuerOrigin } from "@/lib/oauth/config";
import { createPendingMultisigTransaction } from "@/lib/server/createPendingMultisigTransaction";
import { pinJsonLd } from "@/lib/server/pinataUpload";
import { buildRationaleAnchor } from "@/lib/server/rationaleAnchor";
import { withVoteAnchor } from "@/lib/tx-draft/mutations";
import type { TxDraft } from "@/types/tx-draft";

import { loadReviewWalletContext, TxReviewError } from "./context";
import { describeDraftTokenFailure, verifyDraftToken, type VerifiedDraftToken } from "./draft-token";
import {
  buildUnsigned,
  ensureStakeRegistration,
  issueMessages,
  loadDrepRegistered,
  loadSpecAssetMetadata,
  loadSpendableUtxos,
  loadStakeAccountActive,
  renderCard,
  STAKE_REGISTRATION_ADDED_WARNING,
  summarizeForWallet,
  validateOrThrow,
  walletSummaryShape,
  type ReviewDeps,
} from "./pipeline";
import { specToDraft, type TxSpec } from "./spec";
import { REVIEW_CARD_HINT, summaryToText } from "./summary";

/**
 * `transaction_propose`: turn a reviewed draft into a pending transaction.
 *
 * Accepts only the draft token. Rebuilds from the spec inside it against the
 * wallet's current UTxOs, publishes any vote rationale to IPFS (the one
 * public side effect, and the reason it waits for the human's confirmation),
 * and stores the result with zero signatures: `signedAddresses: []`. The
 * helper that persists it would broadcast a single-signer transaction only
 * when the initial signer set already meets the threshold, which an empty
 * set never does — and the result is checked anyway.
 *
 * Idempotent on the token's `jti`: a replay returns the transaction the first
 * call created instead of a second one competing for the same UTxOs.
 */

export type ProposeDeps = ReviewDeps & {
  /** Injectable pinner; defaults to Pinata. */
  pin?: (filename: string, json: string) => Promise<{ url: string }>;
  /** Injectable anchor hash (blake2b-256 over the pretty JSON). */
  hashAnchor?: (doc: Record<string, unknown>) => string;
  createPending?: typeof createPendingMultisigTransaction;
  clientIp?: string;
  /**
   * Which surface confirmed the draft, for the audit row. The web app's
   * task-payout dialog runs this same function and passes "app".
   */
  via?: "mcp" | "app";
  /**
   * Extra top-level txJson namespaces, stamped next to `mcp`. Never under
   * `multisig` (rewritten on every signature). Task payouts add `tasks`.
   */
  txJsonExtras?: (claims: VerifiedDraftToken) => Record<string, unknown>;
  /**
   * Runs inside the database transaction that inserts the pending row; a
   * throw aborts the insert. A thrown `TxReviewError` becomes the tool result.
   */
  afterCreate?: (
    tx: Prisma.TransactionClient,
    created: { id: string },
    claims: VerifiedDraftToken,
  ) => Promise<void>;
};

/** Top-level txJson namespace for MCP provenance. Never under `multisig`, which signTransaction.ts rewrites. */
export const MCP_TXJSON_KEY = "mcp";

export type McpTxJsonProvenance = {
  draftId: string;
  client: string | null;
  proposer: string;
  previewTxHash: string;
  proposedAt: string;
};

export async function runTransactionPropose(
  input: { draftToken: string },
  ctx: ToolContext,
  deps: ProposeDeps,
): Promise<McpToolResult> {
  try {
    const verified = verifyDraftToken(String(input.draftToken ?? ""), {
      subject: ctx.caller.subject,
      clientId: ctx.caller.clientName,
    });
    if (!verified.ok) {
      throw new TxReviewError(
        verified.reason === "subject_mismatch" || verified.reason === "client_mismatch" ? 403 : 401,
        verified.reason === "expired" ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
        describeDraftTokenFailure(verified.reason),
      );
    }
    const { claims } = verified;
    let spec = claims.spec;

    const wallet = await loadReviewWalletContext(deps.db, claims.walletId, ctx.caller);
    const walletShape = walletSummaryShape(wallet);
    const link = `${issuerOrigin()}/wallets/${wallet.walletRow.id}/transactions`;

    // Replay: the same reviewed draft must never become two transactions.
    const existing = await findByDraftId(deps, wallet.walletRow.id, claims.jti);
    if (existing) {
      const body = safeParse(existing.txJson);
      const summary = await summarizeForWallet(deps, body, walletShape, undefined, {
        kind: "pending",
        signedAddresses: existing.signedAddresses,
        rejectedAddresses: existing.rejectedAddresses,
        description: existing.description,
        txHash: existing.txHash ?? claims.previewTxHash,
        transactionId: existing.id,
        warnings: [],
      });
      const image = deps.omitCard ? undefined : await renderCard(deps, summary);
      return {
        status: 200,
        body: {
          transactionId: existing.id,
          alreadyExisted: true,
          txHash: summary.txHash,
          previewTxHash: claims.previewTxHash,
          signaturesRequired: wallet.threshold.required,
          link,
          summary,
          ...(image ? { reviewCard: REVIEW_CARD_HINT } : {}),
          persisted: true,
          signed: false,
          broadcast: false,
        },
        text: `This draft was already proposed as transaction ${existing.id}; nothing new was created.\n${summaryToText(summary)}\nSign it at ${link}`,
        ...(image ? { images: [image] } : {}),
        audit: { walletId: wallet.walletRow.id, transactionId: existing.id, draftId: claims.jti, replay: true },
      };
    }

    const assets = await loadSpecAssetMetadata(spec, wallet.network);
    const availableUtxos = await loadSpendableUtxos(deps, wallet.walletRow.id);
    // Re-checked, not carried in the token: the account may have been
    // registered (validation then refuses the token's registration) or
    // deregistered (a registration is added, and the hash change reported)
    // since the preview. The DRep registration is re-checked for the same
    // reason: a DRep retired after the preview can no longer vote.
    const [stakeAccountActive, drepRegistered] = await Promise.all([
      loadStakeAccountActive(wallet, spec),
      loadDrepRegistered(wallet, spec),
    ]);
    const registration = ensureStakeRegistration(spec, stakeAccountActive);
    spec = registration.spec;
    let draft = specToDraft(spec, "mcp-propose");
    const draftWarnings = validateOrThrow(
      draft,
      wallet,
      availableUtxos,
      stakeAccountActive,
      drepRegistered,
    );

    // Rationales are pinned only now — public and permanent, so only after
    // the human said yes and only for a draft that still validates.
    const anchored = await anchorRationales(draft, spec, deps);
    draft = anchored.draft;

    const built = await buildUnsigned(draft, wallet, availableUtxos);

    const provenance: McpTxJsonProvenance = {
      draftId: claims.jti,
      client: ctx.caller.clientName,
      proposer: ctx.caller.subject,
      previewTxHash: claims.previewTxHash,
      proposedAt: new Date().toISOString(),
    };
    const txJson = {
      ...(built.body as object),
      [MCP_TXJSON_KEY]: provenance,
      ...(deps.txJsonExtras?.(claims) ?? {}),
    };

    const createPending = deps.createPending ?? createPendingMultisigTransaction;
    const afterCreate = deps.afterCreate;
    const created = await createPending(deps.db, {
      walletId: wallet.walletRow.id,
      wallet: {
        numRequiredSigners: wallet.walletRow.numRequiredSigners,
        type: wallet.walletRow.type,
      },
      proposerAddress: ctx.caller.subject,
      txCbor: built.unsignedTx,
      txJson,
      description: spec.description || "MCP draft",
      network: wallet.network,
      initialSignedAddresses: [],
      notificationCreatorAddress: null,
      ...(afterCreate
        ? { afterCreate: (tx, row) => afterCreate(tx, { id: row.id }, claims) }
        : {}),
    });
    if (typeof created === "string" || !created || typeof created !== "object" || !("id" in created)) {
      // A string would be a submitted tx hash — a broadcast. It cannot
      // happen with an empty signer set, and it must never pass silently.
      throw new Error("Unexpected persistence result for an unsigned draft");
    }

    void audit(deps.db, {
      actorAddress: ctx.caller.subject,
      actorType: "user",
      action: "transaction.create",
      resourceType: "transaction",
      resourceId: created.id,
      ip: deps.clientIp ?? ctx.clientIp,
      outcome: "success",
      metadata: {
        walletId: wallet.walletRow.id,
        via: deps.via ?? "mcp",
        client: ctx.caller.clientName,
        txHash: built.txHash,
        mcpDraftId: claims.jti,
        initialSigners: 0,
        rationalesPinned: anchored.pinned,
      },
    });

    const txHashChanged = built.txHash !== claims.previewTxHash;
    const txHashChangeReasons: string[] = [];
    if (txHashChanged) {
      if (anchored.pinned > 0) txHashChangeReasons.push("rationale-anchors");
      if (registration.added) txHashChangeReasons.push("stake-registration");
      if (txHashChangeReasons.length === 0) txHashChangeReasons.push("utxo-set");
    }

    const warnings = [
      ...(registration.added ? [STAKE_REGISTRATION_ADDED_WARNING] : []),
      ...issueMessages(draftWarnings),
      ...(txHashChangeReasons.includes("utxo-set")
        ? [
            "The wallet's spendable UTxOs changed since the preview, so different inputs were selected. Recipients and amounts are unchanged.",
          ]
        : []),
    ];

    const summary = await summarizeForWallet(deps, built.body, walletShape, assets, {
      kind: "pending",
      signedAddresses: [],
      rejectedAddresses: [],
      description: spec.description,
      metadataMessage: spec.metadataMessage,
      paymentCount: spec.outputs.length,
      txHash: built.txHash,
      transactionId: created.id,
      sizeBytes: built.sizeBytes,
      warnings,
    });
    const image = deps.omitCard ? undefined : await renderCard(deps, summary);

    return {
      status: 201,
      body: {
        transactionId: created.id,
        alreadyExisted: false,
        txHash: built.txHash,
        previewTxHash: claims.previewTxHash,
        txHashChanged,
        txHashChangeReasons,
        signaturesRequired: wallet.threshold.required,
        signaturesCollected: 0,
        rationalesPublished: anchored.pinned,
        link,
        summary,
        ...(image ? { reviewCard: REVIEW_CARD_HINT } : {}),
        persisted: true,
        signed: false,
        broadcast: false,
      },
      text: `Created pending transaction ${created.id}. It has no signatures yet; the wallet's signers have been notified and can sign it at ${link}\n${summaryToText(summary)}`,
      ...(image ? { images: [image] } : {}),
      audit: {
        walletId: wallet.walletRow.id,
        transactionId: created.id,
        txHash: built.txHash,
        draftId: claims.jti,
      },
    };
  } catch (error) {
    if (error instanceof TxReviewError) return error.toResult();
    throw error;
  }
}

type PendingRow = {
  id: string;
  txJson: string;
  txHash: string | null;
  description: string | null;
  signedAddresses: string[];
  rejectedAddresses: string[];
};

async function findByDraftId(
  deps: ReviewDeps,
  walletId: string,
  draftId: string,
): Promise<PendingRow | null> {
  const rows = (await deps.db.transaction.findMany({
    where: { walletId, state: 0 },
    select: {
      id: true,
      txJson: true,
      txHash: true,
      description: true,
      signedAddresses: true,
      rejectedAddresses: true,
    },
  })) as PendingRow[];
  for (const row of rows) {
    const parsed = safeParse(row.txJson);
    if (parsed?.[MCP_TXJSON_KEY]?.draftId === draftId) return row;
  }
  return null;
}

function safeParse(txJson: string): any {
  try {
    return JSON.parse(txJson);
  } catch {
    return {};
  }
}

async function anchorRationales(
  draft: TxDraft,
  spec: TxSpec,
  deps: ProposeDeps,
): Promise<{ draft: TxDraft; pinned: number }> {
  let next = draft;
  let pinned = 0;
  for (let index = 0; index < spec.votes.length; index++) {
    const vote = spec.votes[index]!;
    const text = vote.rationale?.trim();
    if (!text) continue;
    try {
      const hashAnchor =
        deps.hashAnchor ??
        (await import("@meshsdk/core")).hashDrepAnchor;
      const anchor = buildRationaleAnchor(
        { summary: text.slice(0, 300), rationaleStatement: text },
        (doc) => hashAnchor(doc),
        `rationale-${vote.govActionTxHash.slice(0, 16)}-${vote.govActionIndex}`,
      );
      const pin = deps.pin ?? ((filename, json) => pinJsonLd(filename, json));
      const { url } = await pin(anchor.filename, anchor.json);
      next = withVoteAnchor(next, `vote-${index}`, {
        anchorUrl: url,
        anchorDataHash: anchor.hash,
      });
      pinned++;
    } catch (error) {
      throw new TxReviewError(
        502,
        "PIN_FAILED",
        `Publishing the rationale for vote ${index + 1} failed: ${error instanceof Error ? error.message : String(error)}. Nothing was created.`,
      );
    }
  }
  return { draft: next, pinned };
}
