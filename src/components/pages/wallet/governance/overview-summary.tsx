import { useEffect, useMemo, useState } from "react";
import CardUI from "@/components/ui/card-content";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Clock,
  Vote as VoteIcon,
  Trophy,
  XCircle,
} from "lucide-react";
import type { Wallet } from "@/types/wallet";
import { useBallot } from "@/hooks/useBallot";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { useSiteStore } from "@/lib/zustand/site";
import { getProvider } from "@/utils/get-provider";
import {
  getProposalStatus,
  type ProposalStatus,
} from "@/lib/governance";
import type { ProposalDetails } from "@/types/governance";

type StatusCounts = Record<ProposalStatus, number>;

const EMPTY_COUNTS: StatusCounts = {
  active: 0,
  enacted: 0,
  ratified: 0,
  dropped: 0,
  expired: 0,
};

function lovelaceToAda(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return null;
  return n / 1_000_000;
}

function formatAda(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M ADA`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k ADA`;
  return `${value.toFixed(2)} ADA`;
}

export default function GovernanceOverviewSummary({ appWallet }: { appWallet: Wallet }) {
  const network = useSiteStore((s) => s.network);
  const drepInfo = useWalletsStore((s) => s.drepInfo);
  const { ballots } = useBallot(appWallet?.id);

  const [statusCounts, setStatusCounts] = useState<StatusCounts>(EMPTY_COUNTS);
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setStatusLoading(true);
    const fetchProposals = async () => {
      try {
        const provider = getProvider(network);
        const proposals = (await provider.get(
          `/governance/proposals?count=100&page=1&order=desc`,
        )) as Array<{ tx_hash: string; cert_index: number | string }>;
        if (!Array.isArray(proposals)) {
          if (!cancelled) setStatusCounts(EMPTY_COUNTS);
          return;
        }
        const counts: StatusCounts = { ...EMPTY_COUNTS };
        const details = await Promise.all(
          proposals.slice(0, 60).map(async (p) => {
            try {
              return (await provider.get(
                `/governance/proposals/${p.tx_hash}/${p.cert_index}`,
              )) as ProposalDetails;
            } catch {
              return null;
            }
          }),
        );
        for (const d of details) {
          const status = getProposalStatus(d);
          if (status) counts[status] += 1;
        }
        if (!cancelled) setStatusCounts(counts);
      } catch (err) {
        console.warn("[overview-summary] failed to fetch proposal statuses", err);
        if (!cancelled) setStatusCounts(EMPTY_COUNTS);
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    };
    void fetchProposals();
    return () => {
      cancelled = true;
    };
  }, [network]);

  const ballotStats = useMemo(() => {
    const total = ballots?.length ?? 0;
    let totalProposals = 0;
    let voted = 0;
    let lastUpdated: Date | null = null;
    for (const b of ballots ?? []) {
      const items = Array.isArray(b.items) ? b.items : [];
      const choices = Array.isArray(b.choices) ? b.choices : [];
      totalProposals += items.length;
      voted += choices.filter((c) => c && c.trim().length > 0).length;
      const u = b.updatedAt ? new Date(b.updatedAt) : null;
      if (u && (!lastUpdated || u > lastUpdated)) lastUpdated = u;
    }
    return { total, totalProposals, voted, lastUpdated };
  }, [ballots]);

  const drepStatus = drepInfo?.active ? "Active" : drepInfo ? "Inactive" : "—";
  const votingPowerAda = lovelaceToAda(drepInfo?.amount ?? null);

  const activeProposals = statusCounts.active;
  const completedProposals = statusCounts.enacted + statusCounts.ratified;
  const closedProposals = statusCounts.dropped + statusCounts.expired;

  return (
    <CardUI title="Governance overview" cardClassName="col-span-2">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          icon={<Clock className="h-4 w-4" />}
          label="Active proposals"
          value={statusLoading ? "…" : String(activeProposals)}
          hint={`${statusLoading ? "…" : completedProposals} ratified · ${
            statusLoading ? "…" : closedProposals
          } closed`}
        />
        <Tile
          icon={<VoteIcon className="h-4 w-4" />}
          label="Ballot progress"
          value={`${ballotStats.voted}/${ballotStats.totalProposals}`}
          hint={`${ballotStats.total} ballot${ballotStats.total === 1 ? "" : "s"}`}
        />
        <Tile
          icon={<Trophy className="h-4 w-4" />}
          label="Voting power"
          value={formatAda(votingPowerAda)}
          hint={`DRep ${drepStatus}`}
        />
        <Tile
          icon={
            ballotStats.lastUpdated ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <XCircle className="h-4 w-4" />
            )
          }
          label="Last ballot activity"
          value={
            ballotStats.lastUpdated
              ? ballotStats.lastUpdated.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "—"
          }
          hint={
            ballotStats.lastUpdated
              ? ballotStats.lastUpdated.toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "No ballots yet"
          }
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Proposal mix:</span>
        <Badge variant="secondary">
          {statusCounts.active} active
        </Badge>
        <Badge variant="secondary">
          {statusCounts.enacted} enacted
        </Badge>
        <Badge variant="secondary">
          {statusCounts.ratified} ratified
        </Badge>
        <Badge variant="secondary">
          {statusCounts.dropped} dropped
        </Badge>
        <Badge variant="secondary">
          {statusCounts.expired} expired
        </Badge>
      </div>
    </CardUI>
  );
}

function Tile({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
