import type { DraftBuildResult } from "@/lib/tx-draft/build-draft-tx";
import { RISK_ASSESSMENT_VERSION } from "./types";
import type { ContractDetails } from "./contract-details";

export function hasContractDetails(details?: ContractDetails): boolean {
  return (
    !!details &&
    (details.spends.length > 0 ||
      details.outputs.some((o) => o.datum.kind !== "none"))
  );
}

export type ReviewDecision = { accepted: boolean; acknowledged: boolean };
export type ReviewAction = "sign" | "export";

export type RiskReview = Pick<DraftBuildResult, "txHash" | "riskAssessment">;

export function reviewNeedsAcknowledgment(result: RiskReview): boolean {
  return (
    result.riskAssessment?.findings.some((f) => f.requiresAcknowledgment) ??
    false
  );
}

/** Presentation check; the action guard additionally binds the hash to the CBOR. */
export function reviewIsComplete(result: RiskReview, network: number): boolean {
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
