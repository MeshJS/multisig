import { baseToDisplay } from "@/lib/tx-draft/decimal";
import type { RiskAssessment } from "./types";

/** Complete, unlabelled facts shared by text, HTML and PNG review surfaces. */
export function riskAssessmentWarnings(risk: RiskAssessment): string[] {
  const warnings = risk.findings.map((finding) => {
    const location =
      finding.outputRole === "collateral-return"
        ? `Collateral return (output ${(finding.outputIndex ?? 0) + 1})`
        : finding.outputIndex !== undefined
          ? `Output ${finding.outputIndex + 1}`
          : finding.inputRef
            ? `Input ${finding.inputRef.txHash}#${finding.inputRef.outputIndex}`
            : "Collateral";
    return [
      `${location}: ${finding.message}`,
      ...(risk.networkId === 1 && finding.requiresAcknowledgment
        ? ["Mainnet: real ADA and tokens are at risk."]
        : []),
      ...(finding.address ? [`Address: ${finding.address}`] : []),
      ...finding.assets.map((asset) =>
        asset.unit === "lovelace"
          ? `${baseToDisplay(asset.quantity, 6)} ADA`
          : `${asset.quantity} base units - ${asset.unit}`,
      ),
    ].join("\n");
  });
  if (risk.collateral) {
    const collateral = risk.collateral;
    warnings.push(
      [
        ...collateral.owners.map(
          (owner) =>
            `Collateral owner ${owner.address}, payment key ${owner.paymentKeyHash}, input ${owner.inputRef.txHash}#${owner.inputRef.outputIndex}: ${baseToDisplay(owner.lovelace, 6)} ADA.`,
        ),
        `Selected collateral: ${baseToDisplay(collateral.selectedLovelace, 6)} ADA.`,
        `Recorded return: ${baseToDisplay(collateral.returnedLovelace, 6)} ADA${collateral.returnAddress ? ` to ${collateral.returnAddress}` : ""}.`,
        `Maximum exposure if an included transaction fails script execution: ${baseToDisplay(collateral.maximumExposureLovelace, 6)} ADA.`,
      ].join("\n"),
    );
  }
  if (risk.status !== "complete" || risk.errors.length)
    warnings.unshift(
      "Unable to verify this transaction. Retry before signing or proposing.",
      ...risk.errors.map((error) => error.message),
    );
  if (risk.findings.some((finding) => finding.requiresAcknowledgment))
    warnings.push(
      "Proposal confirmation creates an unsigned pending transaction only. Each wallet signer must independently review and acknowledge these outputs before signing.",
    );
  return warnings;
}
