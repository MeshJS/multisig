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
          className="flex items-start gap-1.5 text-xs"
        >
          {issue.level === "error" ? (
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          ) : (
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          )}
          <span className="text-muted-foreground">{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}
