import { reviewIsComplete } from "./review-policy";
import type { RiskAssessment } from "./types";

/**
 * Final, uncached check shared by builder and pending actions. The binding includes
 * contract arguments and budgets, not just risk findings or the transaction hash.
 * Availability is established at this point in time; this does not reserve inputs.
 */
export async function revalidateReview(options: {
  txHash: string;
  network: number;
  binding: string;
  isCurrent: () => boolean;
  refresh: () => Promise<RiskAssessment>;
}): Promise<boolean> {
  if (!options.isCurrent()) return false;
  let latest: RiskAssessment;
  try {
    latest = await options.refresh();
  } catch {
    if (!options.isCurrent()) return false;
    throw new Error(
      "Unable to refresh transaction facts. Retry review before signing or exporting; rebuild if inputs are unavailable.",
    );
  }
  if (!options.isCurrent()) return false;
  if (
    options.binding !== JSON.stringify(latest) ||
    !reviewIsComplete(
      { txHash: options.txHash, riskAssessment: latest },
      options.network,
    )
  )
    throw new Error(
      "Transaction risk facts changed or are incomplete. Review the updated transaction and retry; rebuild if inputs are unavailable. A new confirmation is required before signing or exporting.",
    );
  return true;
}
