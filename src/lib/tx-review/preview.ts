import type { McpToolResult, ToolContext } from "@/lib/mcp/tools";

import { loadReviewWalletContext, type ReviewWalletContext, TxReviewError } from "./context";
import { DRAFT_TOKEN_TTL_SECONDS, type DraftOrigin, mintDraftToken } from "./draft-token";
import type { ResolvedAssetMetadata } from "./metadata";
import {
  buildUnsigned,
  ensureStakeRegistration,
  issueMessages,
  loadDrepRegistered,
  loadSpecAssetMetadata,
  loadSpendableUtxos,
  loadStakeAccountActive,
  pendingRationalesOf,
  renderCard,
  STAKE_REGISTRATION_ADDED_WARNING,
  summarizeForWallet,
  validateOrThrow,
  walletSummaryShape,
  type ReviewDeps,
} from "./pipeline";
import { hasSpecErrors, normalizeTxSpec, specToDraft, type TxSpec, type TxSpecInput } from "./spec";
import { REVIEW_CARD_HINT, REVIEW_CARD_INLINE_HINT, summaryToText } from "./summary";

/**
 * `transaction_preview`: build the unsigned transaction and show it.
 *
 * Persists nothing. What comes back is the review card, a readable summary,
 * and a draft token that is the only thing `transaction_propose` will
 * accept — see `draft-token.ts` for why that shape matters.
 */
export async function runTransactionPreview(
  input: TxSpecInput,
  ctx: ToolContext,
  deps: ReviewDeps,
): Promise<McpToolResult> {
  try {
    const wallet = await loadReviewWalletContext(deps.db, input.walletId, ctx.caller);

    // Units first: the display→base conversion needs each token's decimals.
    const probe = normalizeTxSpec(input, { decimalsFor: () => 0 });
    const assets = await loadSpecAssetMetadata(probe.spec, wallet.network);
    const { spec: requested, issues: specIssues } = normalizeTxSpec(input, {
      decimalsFor: assets.decimalsFor,
    });
    if (hasSpecErrors(specIssues)) {
      throw new TxReviewError(
        400,
        "INVALID_SPEC",
        `The request could not be understood: ${specIssues
          .filter((i) => i.level === "error")
          .map((i) => i.message)
          .join(" ")}`,
        { issues: specIssues },
      );
    }

    return await runSpecPreview(requested, ctx, deps, {
      wallet,
      assets,
      specWarnings: specIssues.filter((i) => i.level === "warning").map((i) => i.message),
    });
  } catch (error) {
    if (error instanceof TxReviewError) return error.toResult();
    throw error;
  }
}

export type SpecPreviewOptions = {
  /** Already-loaded wallet context; loaded from `spec.walletId` when absent. */
  wallet?: ReviewWalletContext;
  /** Already-resolved asset metadata for the spec's units. */
  assets?: ResolvedAssetMetadata;
  /** Normalization warnings to prepend to the draft's own. */
  specWarnings?: string[];
  /** Draft id prefix; shows up nowhere the human sees, but keeps logs readable. */
  draftId?: string;
  /** Bound into the draft token — see `DraftOrigin`. */
  origin?: DraftOrigin;
  /** Merged into the result body (e.g. the tasks a payout covers). */
  extraBody?: Record<string, unknown>;
};

/**
 * The preview from a canonical spec (base units) onward: UTxOs, on-chain
 * probes, validate, build, summarize, card, token. `runTransactionPreview`
 * is the tool-input front end; the task-board payout builds its spec
 * directly from stored recipient rows and enters here.
 *
 * Throws `TxReviewError`; callers map it to a result.
 */
export async function runSpecPreview(
  requested: TxSpec,
  ctx: ToolContext,
  deps: ReviewDeps,
  opts: SpecPreviewOptions = {},
): Promise<McpToolResult> {
  const wallet =
    opts.wallet ?? (await loadReviewWalletContext(deps.db, requested.walletId, ctx.caller));
  const assets = opts.assets ?? (await loadSpecAssetMetadata(requested, wallet.network));

  const availableUtxos = await loadSpendableUtxos(deps, wallet.walletRow.id);
  // Both on-chain registration probes at once; each is skipped when the
  // spec has nothing for it to check.
  const [stakeAccountActive, drepRegistered] = await Promise.all([
    loadStakeAccountActive(wallet, requested),
    loadDrepRegistered(wallet, requested),
  ]);
  // The token is minted from this spec, registration included, so the
  // human confirms the deposit they saw on the card.
  const registration = ensureStakeRegistration(requested, stakeAccountActive);
  const spec = registration.spec;
  const draft = specToDraft(spec, opts.draftId ?? "mcp-preview");
  const draftWarnings = validateOrThrow(
    draft,
    wallet,
    availableUtxos,
    stakeAccountActive,
    drepRegistered,
  );

  const built = await buildUnsigned(draft, wallet, availableUtxos);

  const warnings = [
    ...(opts.specWarnings ?? []),
    ...(registration.added ? [STAKE_REGISTRATION_ADDED_WARNING] : []),
    ...issueMessages(draftWarnings),
  ];
  const summary = await summarizeForWallet(deps, built.body, walletSummaryShape(wallet), assets, {
    kind: "preview",
    signedAddresses: [],
    rejectedAddresses: [],
    description: spec.description,
    metadataMessage: spec.metadataMessage,
    pendingRationales: pendingRationalesOf(spec),
    paymentCount: spec.outputs.length,
    txHash: built.txHash,
    sizeBytes: built.sizeBytes,
    warnings,
  });

  // The token records how the card reached the human, so propose (which takes
  // only the token) answers in the same mode.
  const image = deps.omitCard ? undefined : await renderCard(deps, summary);
  const token = mintDraftToken({
    subject: ctx.caller.subject,
    walletId: wallet.walletRow.id,
    clientId: ctx.caller.clientName,
    spec,
    previewTxHash: built.txHash,
    origin: opts.origin,
    card: image ? "image" : "html",
  });

  return {
    status: 200,
    body: {
      draftToken: token.token,
      expiresAt: new Date(token.expiresAt * 1000).toISOString(),
      expiresInSeconds: DRAFT_TOKEN_TTL_SECONDS,
      txHash: built.txHash,
      fee: built.fee,
      summary,
      warnings,
      reviewCard: image ? REVIEW_CARD_HINT : REVIEW_CARD_INLINE_HINT,
      persisted: false,
      signed: false,
      broadcast: false,
      ...(opts.extraBody ?? {}),
    },
    text: summaryToText(summary, { card: image ? "image" : "html" }),
    ...(image ? { images: [image] } : {}),
    audit: { walletId: wallet.walletRow.id, previewTxHash: built.txHash },
  };
}
