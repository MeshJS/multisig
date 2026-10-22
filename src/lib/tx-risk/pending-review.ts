import { resolveTxHash } from "@meshsdk/core-cst";
import type { RiskAssessment } from "./types";
import {
  reviewIsComplete,
  reviewNeedsAcknowledgment,
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
  const decision = risk.findings.length
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
  const latest = await options.refresh();
  if (!options.isCurrent()) return false;
  if (binding !== JSON.stringify(latest))
    throw new Error(
      "Transaction risk facts changed. Review the updated transaction and retry signing.",
    );
  return reviewIsComplete(
    { ...review, riskAssessment: latest },
    options.network,
  );
}
