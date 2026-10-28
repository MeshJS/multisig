import { resolveTxHash } from "@meshsdk/core-cst";
import type { RiskAssessment } from "./types";
import { revalidateReview } from "./revalidate-review";
import {
  reviewIsComplete,
  reviewNeedsAcknowledgment,
  hasContractDetails,
  type ReviewDecision,
} from "./review-policy";

/** Independent decision on every attempt, including collateral-owner re-signing. */
export async function reviewPendingTransaction(
  txHex: string,
  options: {
    network: number;
    isCurrent: () => boolean;
    refresh: () => Promise<RiskAssessment>;
    confirm: (assessment: RiskAssessment) => Promise<ReviewDecision>;
  },
): Promise<boolean> {
  if (!options.isCurrent()) return false;
  const risk = await options.refresh();
  if (!options.isCurrent()) return false;
  // Decode failures remain visible in the card with a retry action.
  if (!risk.txHash) return false;
  const review = {
    txHash: resolveTxHash(txHex).toLowerCase(),
    riskAssessment: risk,
  };
  if (!reviewIsComplete(review, options.network)) return false;
  const binding = JSON.stringify(risk);
  const decision =
    risk.findings.length ||
    hasContractDetails(risk.contractDetails) ||
    risk.contractDetails?.requiredSigners.length
      ? await options.confirm(risk)
      : { accepted: true, acknowledged: false };
  if (
    !decision.accepted ||
    !options.isCurrent() ||
    (reviewNeedsAcknowledgment(review) && !decision.acknowledged)
  )
    return false;
  // A dialog can stay open while an input is spent or provider facts change.
  // Refresh again; any changed facts require a new attempt and decision.
  return revalidateReview({
    txHash: review.txHash,
    network: options.network,
    binding,
    isCurrent: () => options.isCurrent() && binding === JSON.stringify(risk),
    refresh: options.refresh,
  });
}
