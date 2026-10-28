import { resolveTxHash } from "@meshsdk/core-cst";
import type { DraftBuildResult } from "@/lib/tx-draft/build-draft-tx";
import type { RiskAssessment } from "./types";
import { revalidateReview } from "./revalidate-review";
import {
  hasContractDetails,
  reviewIsComplete,
  reviewNeedsAcknowledgment,
  type ReviewDecision,
} from "./review-policy";
export type { ReviewDecision, ReviewAction } from "./review-policy";

/** Every action gets a fresh assessment and its own decision. No reusable acceptance. */
export async function reviewBuiltTransaction(
  result: DraftBuildResult,
  options: {
    network: number;
    isCurrent: () => boolean;
    refresh: (txHex: string) => Promise<RiskAssessment>;
    confirm: (reviewed: DraftBuildResult) => Promise<ReviewDecision>;
  },
): Promise<boolean> {
  const { isCurrent } = options;
  if (!isCurrent()) return false;
  const originalHex = result.unsignedTx;
  if (resolveTxHash(originalHex).toLowerCase() !== result.txHash)
    throw new Error("Transaction changed. Build and review it again.");
  const reviewed = {
    ...result,
    riskAssessment: await options.refresh(originalHex),
  };
  if (!isCurrent()) return false;
  // Show an incomplete review as a correction state, never silently skip it.
  const needsReview =
    !reviewIsComplete(reviewed, options.network) ||
    reviewed.riskAssessment.findings.length > 0 ||
    hasContractDetails(reviewed.riskAssessment.contractDetails) ||
    !!reviewed.plutusReview ||
    reviewed.body.requiredSignatures.length > 0 ||
    reviewed.outputReview?.some((o) => o.inlineDatum !== undefined);
  const binding = JSON.stringify([originalHex, reviewed.riskAssessment]);
  const decision = needsReview
    ? await options.confirm(reviewed)
    : { accepted: true, acknowledged: false };
  const decisionIsCurrent = () =>
    isCurrent() &&
    result.unsignedTx === originalHex &&
    binding === JSON.stringify([reviewed.unsignedTx, reviewed.riskAssessment]);
  if (!(
    decision.accepted &&
    decisionIsCurrent() &&
    reviewIsComplete(reviewed, options.network) &&
    (!reviewNeedsAcknowledgment(reviewed) || decision.acknowledged)
  ))
    return false;
  return revalidateReview({
    txHash: result.txHash,
    network: options.network,
    binding: JSON.stringify(reviewed.riskAssessment),
    isCurrent: decisionIsCurrent,
    refresh: () => options.refresh(originalHex),
  });
}
