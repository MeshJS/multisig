import { CircleAlert, TriangleAlert } from "lucide-react";

import type { DraftIssue } from "@/lib/tx-draft/validate";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import { cn } from "@/lib/utils";

/**
 * Floating issue list over the canvas. Clicking an issue selects the
 * offending card so the inspector opens on it.
 */
export default function ProblemsPanel({ issues }: { issues: DraftIssue[] }) {
  const select = useTxBuilderStore((state) => state.select);
  if (issues.length === 0) return null;

  return (
    <div
      data-testid="tx-builder-problems"
      className="absolute bottom-3 left-3 z-10 max-h-44 w-80 overflow-y-auto rounded-md border border-border/60 bg-card/95 shadow-md"
    >
      <ul className="divide-y divide-border/40">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${issue.outputId ?? index}`}>
            <button
              type="button"
              className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted/50"
              onClick={() =>
                select(
                  issue.outputId
                    ? { kind: "output", outputId: issue.outputId }
                    : { kind: "tx" },
                )
              }
            >
              {issue.level === "error" ? (
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
              ) : (
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              )}
              <span
                className={cn(
                  issue.level === "error"
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {issue.message}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
