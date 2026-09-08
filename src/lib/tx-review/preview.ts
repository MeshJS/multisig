import type { McpToolResult, ToolContext } from "@/lib/mcp/tools";

import { loadReviewWalletContext, TxReviewError } from "./context";
import { DRAFT_TOKEN_TTL_SECONDS, mintDraftToken } from "./draft-token";
import {
  buildUnsigned,
  issueMessages,
  loadSpecAssetMetadata,
  loadSpendableUtxos,
  pendingRationalesOf,
  renderCard,
  summarizeForWallet,
  validateOrThrow,
  walletSummaryShape,
  type ReviewDeps,
} from "./pipeline";
import { hasSpecErrors, normalizeTxSpec, specToDraft, type TxSpecInput } from "./spec";
import { REVIEW_CARD_HINT, summaryToText } from "./summary";

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
    const { spec, issues: specIssues } = normalizeTxSpec(input, {
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

    const availableUtxos = await loadSpendableUtxos(deps, wallet.walletRow.id);
    const draft = specToDraft(spec, "mcp-preview");
    const draftWarnings = validateOrThrow(draft, wallet, availableUtxos);

    const built = await buildUnsigned(draft, wallet, availableUtxos);

    const warnings = [
      ...specIssues.filter((i) => i.level === "warning").map((i) => i.message),
      ...issueMessages(draftWarnings),
    ];
    const summary = await summarizeForWallet(deps, built.body, walletSummaryShape(wallet), assets, {
      kind: "preview",
      signedAddresses: [],
      rejectedAddresses: [],
      description: spec.description,
      metadataMessage: spec.metadataMessage,
      pendingRationales: pendingRationalesOf(spec),
      txHash: built.txHash,
      sizeBytes: built.sizeBytes,
      warnings,
    });

    const image = await renderCard(deps, summary);
    const token = mintDraftToken({
      subject: ctx.caller.subject,
      walletId: wallet.walletRow.id,
      clientId: ctx.caller.clientName,
      spec,
      previewTxHash: built.txHash,
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
        reviewCard: REVIEW_CARD_HINT,
        persisted: false,
        signed: false,
        broadcast: false,
      },
      text: summaryToText(summary),
      images: [image],
      audit: { walletId: wallet.walletRow.id, previewTxHash: built.txHash },
    };
  } catch (error) {
    if (error instanceof TxReviewError) return error.toResult();
    throw error;
  }
}
