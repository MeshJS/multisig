import { TxReviewError } from "@/lib/tx-review/context";
import { resolveAssetMetadata } from "@/lib/tx-review/metadata";
import { collectSpecUnits, hasSpecErrors, normalizeTxSpec } from "@/lib/tx-review/spec";
import { getProvider } from "@/utils/get-provider";

/**
 * Task recipients as a caller writes them: display units, the same item
 * shape as `transaction_preview`'s outputs (`ada`, or a token with its
 * registered decimals).
 */
export type DisplayRecipient = {
  address: string;
  ada?: string;
  assets?: { unit: string; quantity: string }[];
};

/** Task recipients as the board stores them: one row per (address, unit), base units. */
export type BaseRecipient = { address: string; unit: string; quantity: string };

/**
 * Display-unit recipients → base-unit rows, through the same normalization
 * `transaction_preview` uses (registry decimals; a fractional amount for a
 * token without registered decimals is refused, never guessed). Used by the
 * v1 `taskUpsert` handler, so REST and MCP callers share one contract.
 *
 * Throws `TxReviewError("INVALID_SPEC")` with the issue list.
 */
export async function recipientsToBaseUnits(
  network: 0 | 1,
  walletId: string,
  recipients: DisplayRecipient[],
): Promise<BaseRecipient[]> {
  if (recipients.length === 0) return [];
  const input = { walletId, outputs: recipients };
  const assets = await resolveAssetMetadata(getProvider(network), collectSpecUnits(input), network);
  const { spec, issues } = normalizeTxSpec(input, { decimalsFor: assets.decimalsFor });
  if (hasSpecErrors(issues)) {
    throw new TxReviewError(
      400,
      "INVALID_SPEC",
      `The recipients could not be understood: ${issues
        .filter((i) => i.level === "error")
        .map((i) => i.message)
        .join(" ")}`,
      { issues },
    );
  }
  return spec.outputs.flatMap((output) =>
    output.assets.map((asset) => ({ address: output.address, unit: asset.unit, quantity: asset.quantity })),
  );
}
