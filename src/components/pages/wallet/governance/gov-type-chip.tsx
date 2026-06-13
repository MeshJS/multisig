import React from "react";
import { Badge } from "@/components/ui/badge";
import {
  XCircle,
  Hash,
  Coins,
  FileText,
  Settings2,
  GitBranch,
  Users,
} from "lucide-react";

type GovTypeChip = {
  label: string;
  className: string;
  Icon: React.ComponentType<{ className?: string }>;
};

// Color-coded chip per Conway governance action type. Keys match the
// `governance_type` strings returned by the proposals endpoint.
export const GOV_TYPE_CHIPS: Record<string, GovTypeChip> = {
  treasury_withdrawals: {
    label: "Treasury Withdrawal",
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300",
    Icon: Coins,
  },
  info_action: {
    label: "Info Action",
    className:
      "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300",
    Icon: FileText,
  },
  parameter_change: {
    label: "Parameter Change",
    className:
      "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900/50 dark:bg-purple-950/40 dark:text-purple-300",
    Icon: Settings2,
  },
  hard_fork_initiation: {
    label: "Hard Fork",
    className:
      "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/50 dark:bg-orange-950/40 dark:text-orange-300",
    Icon: GitBranch,
  },
  no_confidence: {
    label: "No Confidence",
    className:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300",
    Icon: XCircle,
  },
  new_constitution: {
    label: "New Constitution",
    className:
      "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900/50 dark:bg-teal-950/40 dark:text-teal-300",
    Icon: FileText,
  },
  new_committee: {
    label: "Committee Update",
    className:
      "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-300",
    Icon: Users,
  },
  update_committee: {
    label: "Committee Update",
    className:
      "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-300",
    Icon: Users,
  },
};

const toTitleCase = (value: string): string =>
  value
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export function GovernanceTypeChip({
  governanceType,
}: {
  governanceType: string;
}) {
  const cfg = GOV_TYPE_CHIPS[governanceType] ?? {
    label: toTitleCase(governanceType) || "Unknown",
    className:
      "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300",
    Icon: Hash,
  };
  const Icon = cfg.Icon;
  return (
    <Badge variant="outline" className={`gap-1 font-medium ${cfg.className}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

export default GovernanceTypeChip;
