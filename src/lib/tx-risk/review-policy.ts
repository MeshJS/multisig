import type { DraftBuildResult } from "@/lib/tx-draft/build-draft-tx";
import { RISK_ASSESSMENT_VERSION } from "./types";

export type ReviewDecision = { accepted: boolean; acknowledged: boolean };
export type ReviewAction = "sign" | "export";

export function reviewNeedsAcknowledgment(result: DraftBuildResult): boolean {
  return (
    result.riskAssessment?.findings.some((f) => f.requiresAcknowledgment) ??
    false
  );
}

/** Presentation check; the action guard additionally binds the hash to the CBOR. */
export function reviewIsComplete(
  result: DraftBuildResult,
  network: number,
): boolean {
  const risk = result.riskAssessment;
  return (
    !!risk &&
    risk.status === "complete" &&
    risk.errors.length === 0 &&
    risk.scope === "transaction" &&
    risk.version === RISK_ASSESSMENT_VERSION &&
    risk.networkId === (network === 1 ? 1 : 0) &&
    risk.txHash === result.txHash
  );
}
