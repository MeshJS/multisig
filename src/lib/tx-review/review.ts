import type { V1Result } from "@/lib/mcp/invokeV1";
import type { McpToolResult, ToolContext } from "@/lib/mcp/tools";
import { getRequiredSignerCount } from "@/lib/notifications/center";
import { resolveWalletScriptAddress } from "@/lib/server/walletScriptAddress";
import type { DbWalletWithLegacy } from "@/types/wallet";

import { networkFromAddress, TxReviewError } from "./context";
import { renderCard, summarizeForWallet, type ReviewDeps } from "./pipeline";
import { REVIEW_CARD_HINT, REVIEW_CARD_INLINE_HINT, summaryToText } from "./summary";

/**
 * `multisig_review_pending_transaction`: the review card for a transaction
 * that already exists, whoever created it.
 *
 * Authorization is the pending-transactions v1 handler's: it returns rows
 * only for a signer (human JWT) or a bot with access, and observers may look.
 * The wallet row is read afterwards purely for names and the threshold.
 */
export async function runPendingTransactionReview(
  input: { walletId: string; transactionId: string },
  ctx: ToolContext,
  deps: ReviewDeps & { fetchPendingTransactions: (walletId: string) => Promise<V1Result> },
): Promise<McpToolResult> {
  try {
    const listed = await deps.fetchPendingTransactions(input.walletId);
    if (listed.status >= 400) {
      return listed;
    }
    const rows = Array.isArray(listed.body) ? (listed.body as PendingRow[]) : [];
    const row = rows.find((r) => r?.id === input.transactionId);
    if (!row) {
      throw new TxReviewError(
        404,
        "NOT_FOUND",
        "No pending transaction with that id in this wallet (it may have been submitted or deleted).",
      );
    }

    const walletRow = await deps.db.wallet.findUnique({ where: { id: input.walletId } });
    if (!walletRow) throw new TxReviewError(404, "NOT_FOUND", "Wallet not found");

    const body = safeParse(row.txJson);
    const network = networkFromAddress(ctx.caller.subject);
    let address: string;
    try {
      address = resolveWalletScriptAddress(walletRow as DbWalletWithLegacy, ctx.caller.subject);
    } catch {
      address = typeof body?.changeAddress === "string" ? body.changeAddress : "";
    }

    const txHash = row.txHash ?? (await bodyHashOf(row.txCbor)) ?? "";

    const summary = await summarizeForWallet(
      deps,
      body,
      {
        id: walletRow.id,
        name: walletRow.name,
        address,
        network,
        signersAddresses: walletRow.signersAddresses,
        signersDescriptions: walletRow.signersDescriptions,
        threshold: {
          required: getRequiredSignerCount(walletRow),
          total: walletRow.signersAddresses.length,
          type: walletRow.type,
        },
      },
      undefined,
      {
        kind: "pending",
        signedAddresses: row.signedAddresses ?? [],
        rejectedAddresses: row.rejectedAddresses ?? [],
        description: row.description,
        txHash,
        transactionId: row.id,
        sizeBytes: typeof row.txCbor === "string" ? Math.ceil(row.txCbor.length / 2) : undefined,
        warnings: [],
      },
    );
    const image = deps.omitCard ? undefined : await renderCard(deps, summary);

    return {
      status: 200,
      body: {
        transactionId: row.id,
        txHash,
        summary,
        reviewCard: image ? REVIEW_CARD_HINT : REVIEW_CARD_INLINE_HINT,
        createdAt: row.createdAt ?? null,
      },
      text: summaryToText(summary, { card: image ? "image" : "html" }),
      ...(image ? { images: [image] } : {}),
      audit: { walletId: input.walletId, transactionId: row.id },
    };
  } catch (error) {
    if (error instanceof TxReviewError) return error.toResult();
    throw error;
  }
}

type PendingRow = {
  id: string;
  txJson: string;
  txCbor: string;
  txHash: string | null;
  description: string | null;
  signedAddresses: string[];
  rejectedAddresses: string[];
  createdAt?: string | Date;
};

function safeParse(txJson: string): any {
  try {
    return JSON.parse(txJson);
  } catch {
    return {};
  }
}

async function bodyHashOf(txCbor: unknown): Promise<string | undefined> {
  if (typeof txCbor !== "string" || !txCbor) return undefined;
  try {
    const { resolveTxHash } = await import("@meshsdk/core-cst");
    return resolveTxHash(txCbor).toLowerCase();
  } catch {
    return undefined;
  }
}
