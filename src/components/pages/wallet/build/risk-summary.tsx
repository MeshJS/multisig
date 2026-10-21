import type { RiskFinding } from "@/lib/tx-risk/types";
import { baseToDisplay } from "@/lib/tx-draft/decimal";

/** Reused in contextual editing, build results and final review; never collapsed. */
export default function RiskSummary({
  findings,
  network,
  onSelect,
}: {
  findings: RiskFinding[];
  network: number;
  onSelect?: (finding: RiskFinding) => void;
}) {
  if (!findings.length) return null;
  return (
    <div
      className="min-w-0 space-y-2"
      data-testid="tx-risk-summary"
      aria-live="polite"
    >
      {findings.map((finding, index) => {
        const title =
          finding.action === "collateral"
            ? "Collateral at risk"
            : finding.action === "spend-script"
              ? "Script input"
              : finding.outputRole === "collateral-return"
                ? "Collateral return"
                : `Output ${(finding.outputIndex ?? 0) + 1}`;
        return (
          <div
            key={`${finding.code}:${finding.outputId ?? finding.outputIndex ?? finding.inputRef?.txHash}:${index}`}
            data-risk-code={finding.code}
            className={`min-w-0 space-y-1 rounded-md border p-3 text-xs ${finding.severity === "danger" ? "border-destructive bg-destructive/10" : "border-amber-500/50 bg-amber-500/5"}`}
          >
            <p className="font-semibold">
              {title}
              {finding.requiresAcknowledgment && " · Anyone can spend"}
            </p>
            {network === 1 && finding.requiresAcknowledgment && (
              <p className="font-semibold text-destructive">
                Mainnet: real ADA and tokens are at risk.
              </p>
            )}
            <p>{finding.message}</p>
            {finding.address && (
              <p className="break-all font-mono">{finding.address}</p>
            )}
            {finding.inputRef && (
              <p className="break-all">
                Input: {finding.inputRef.txHash}#{finding.inputRef.outputIndex}
              </p>
            )}
            <ul className="space-y-1">
              {finding.assets.map((asset) => (
                <li key={asset.unit} className="break-all">
                  {asset.unit === "lovelace"
                    ? `${baseToDisplay(asset.quantity, 6)} ADA`
                    : `${asset.quantity} base units · ${asset.unit}`}
                </li>
              ))}
            </ul>
            {onSelect && (finding.outputId || finding.inputId) && (
              <button
                type="button"
                className="font-medium underline"
                onClick={() => onSelect(finding)}
              >
                Review {title.toLowerCase()}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
