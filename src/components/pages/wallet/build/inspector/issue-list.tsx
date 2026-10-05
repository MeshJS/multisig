import { CircleAlert, TriangleAlert } from "lucide-react";

import type { DraftIssue } from "@/lib/tx-draft/validate";

/** Inline issue callouts under an inspector form. */
export default function IssueList({ issues }: { issues: DraftIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {issues.map((issue, index) => (
        <li
          key={`${issue.code}-${index}`}
          data-input-id={issue.inputId}
          data-field={issue.field}
          className="flex items-start gap-1.5 text-xs"
        >
          {issue.level === "error" ? (
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          ) : (
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          )}
          <span className="text-muted-foreground">
            {issue.inputRef && (
              <span
                className="mr-1 font-mono"
                title={`${issue.inputRef.txHash}#${issue.inputRef.outputIndex}`}
              >
                {issue.inputRef.txHash.slice(0, 8) || "Input"}#
                {issue.inputRef.outputIndex}:
              </span>
            )}
            {issue.message}
          </span>
        </li>
      ))}
    </ul>
  );
}
