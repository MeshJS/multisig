import { useEffect, useState } from "react";
import { CircleAlert, TriangleAlert, X } from "lucide-react";

import { GLASS_PANEL_CLASS } from "@/components/common/token-flow/flow-canvas";
import type { DraftIssue } from "@/lib/tx-draft/validate";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import { cn } from "@/lib/utils";

/** How long a freshly changed issue list stays on screen before fading. */
const AUTO_HIDE_MS = 4000;

/**
 * Issue indicator over the canvas. The full list flashes up whenever the set
 * of issues changes, then fades away so it never sits on top of the flow
 * diagram; a small count pill remains and expands the list on click.
 * Clicking an issue selects the offending card so the inspector opens on it.
 */
export default function ProblemsPanel({ issues }: { issues: DraftIssue[] }) {
  const select = useTxBuilderStore((state) => state.select);
  const [pinned, setPinned] = useState(false);
  const [flash, setFlash] = useState(false);

  // Message identity, not array identity — validateDraft returns a fresh
  // array every render, but the flash should only fire on real changes.
  const signature = issues
    .map((issue) => `${issue.code}:${issue.outputId ?? ""}`)
    .join("|");

  useEffect(() => {
    if (!signature) {
      setFlash(false);
      return;
    }
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [signature]);

  if (issues.length === 0) return null;

  const errorCount = issues.filter((issue) => issue.level === "error").length;
  const warningCount = issues.length - errorCount;
  const open = pinned || flash;

  return (
    <div className="absolute bottom-3 left-3 z-10">
      <button
        type="button"
        data-testid="tx-builder-problems-toggle"
        aria-label="Show problems"
        className={cn(
          "absolute bottom-0 left-0 flex items-center gap-2 whitespace-nowrap rounded-full px-2.5 py-1 text-xs transition-opacity duration-300 hover:bg-muted/50",
          GLASS_PANEL_CLASS,
          open && "pointer-events-none opacity-0",
        )}
        onClick={() => setPinned(true)}
      >
        {errorCount > 0 && (
          <span className="flex items-center gap-1">
            <CircleAlert className="h-3.5 w-3.5 text-destructive" />
            {errorCount}
          </span>
        )}
        {warningCount > 0 && (
          <span className="flex items-center gap-1">
            <TriangleAlert className="h-3.5 w-3.5 text-warning" />
            {warningCount}
          </span>
        )}
      </button>

      <div
        data-testid="tx-builder-problems"
        className={cn(
          "absolute bottom-0 left-0 w-80 rounded-md transition-opacity duration-500",
          GLASS_PANEL_CLASS,
          !open && "pointer-events-none opacity-0",
        )}
      >
        <div className="flex items-center justify-between border-b border-border/40 px-2.5 py-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Problems ({issues.length})
          </span>
          <button
            type="button"
            data-testid="tx-builder-problems-close"
            aria-label="Hide problems"
            className="rounded p-0.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            onClick={() => {
              setPinned(false);
              setFlash(false);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <ul className="max-h-40 divide-y divide-border/40 overflow-y-auto">
          {issues.map((issue, index) => (
            <li key={`${issue.code}-${issue.outputId ?? index}`}>
              <button
                type="button"
                className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted/50"
                onClick={() => {
                  // Keep the list up while the user works through it.
                  setPinned(true);
                  select(
                    issue.outputId
                      ? { kind: "output", outputId: issue.outputId }
                      : { kind: "tx" },
                  );
                }}
              >
                {issue.level === "error" ? (
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                ) : (
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
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
    </div>
  );
}
