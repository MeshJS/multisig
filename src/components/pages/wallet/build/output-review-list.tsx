import type { OutputReview } from "@/lib/tx-draft/outputs";
import { baseToDisplay } from "@/lib/tx-draft/decimal";
import { getFirstAndLast } from "@/utils/strings";

export default function OutputReviewList({
  outputs,
}: {
  outputs: OutputReview[];
}) {
  return (
    <ul
      className="flex min-w-0 flex-col gap-2 text-xs"
      data-testid="tx-builder-output-review"
    >
      {outputs.map((output, index) => (
        <li key={output.id} className="rounded border p-2">
          <div className="flex flex-wrap justify-between gap-2">
            <span title={output.address}>
              Output {index + 1} · {getFirstAndLast(output.address, 12, 6)}
            </span>
            <span>{baseToDisplay(output.actualLovelace, 6)} ADA</span>
          </div>
          {output.actualLovelace !== output.requestedLovelace && (
            <p className="mt-1 text-muted-foreground">
              Adjusted from {baseToDisplay(output.requestedLovelace, 6)} ADA to
              meet the output minimum.
            </p>
          )}
          {output.inlineDatum !== undefined && (
            <details className="mt-1">
              <summary className="cursor-pointer">
                Inline datum · {output.inlineDatum.length / 2} bytes
              </summary>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all">
                {output.inlineDatum}
              </pre>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
