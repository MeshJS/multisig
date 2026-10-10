import { useEffect, useState } from "react";
import CardUI from "@/components/ui/card-content";
import { Users, FileText, Coins } from "lucide-react";
import { getProvider } from "@/utils/get-provider";
import { useWallet } from "@meshsdk/react";
import type { BlockfrostDrepInfo } from "@/types/governance";

type Stats = {
  drepCount: number | null;
  activeDrepCount: number | null;
  totalDelegatedAda: number | null;
  activeProposals: number | null;
};

const INITIAL: Stats = {
  drepCount: null,
  activeDrepCount: null,
  totalDelegatedAda: null,
  activeProposals: null,
};

function formatNumber(n: number | null): string {
  if (n == null) return "…";
  return n.toLocaleString();
}

function formatAda(n: number | null): string {
  if (n == null) return "…";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B ₳`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M ₳`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k ₳`;
  return `${n.toFixed(0)} ₳`;
}

export default function GovernanceNetworkStats() {
  const { wallet, connected } = useWallet();
  const [network, setNetwork] = useState<number>(1);
  const [stats, setStats] = useState<Stats>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    const fetchNet = async () => {
      if (connected && wallet) {
        try {
          const n = await wallet.getNetworkId();
          if (!cancelled) setNetwork(n);
        } catch {
          /* default to mainnet */
        }
      }
    };
    void fetchNet();
    return () => {
      cancelled = true;
    };
  }, [connected, wallet]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const provider = getProvider(network);
        const [drepsPage, proposalsPage] = await Promise.all([
          provider
            .get(`/governance/dreps/?count=100&page=1&order=desc`)
            .catch(() => [] as BlockfrostDrepInfo[]),
          provider
            .get(`/governance/proposals?count=100&page=1&order=desc`)
            .catch(() => [] as Array<{ tx_hash: string; cert_index: number }>),
        ]);
        const dreps = Array.isArray(drepsPage) ? (drepsPage as BlockfrostDrepInfo[]) : [];
        const totalLovelace = dreps.reduce((acc, d) => {
          const amt = d?.amount ? parseInt(String(d.amount), 10) : 0;
          return acc + (Number.isFinite(amt) ? amt : 0);
        }, 0);
        const activeCount = dreps.filter((d) => Boolean(d?.active)).length;
        const proposals = Array.isArray(proposalsPage) ? proposalsPage : [];

        if (!cancelled) {
          setStats({
            drepCount: dreps.length,
            activeDrepCount: activeCount,
            totalDelegatedAda: totalLovelace / 1_000_000,
            activeProposals: proposals.length,
          });
        }
      } catch {
        if (!cancelled) setStats(INITIAL);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [network]);

  return (
    <CardUI
      title="Live Cardano governance"
      description={`Snapshot from ${network === 0 ? "preprod" : "mainnet"} (first 100 DReps and proposals).`}
      cardClassName="w-full"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Tile
          icon={<Users className="h-4 w-4" />}
          label="DReps tracked"
          value={formatNumber(stats.drepCount)}
          hint={
            stats.activeDrepCount != null
              ? `${stats.activeDrepCount} active`
              : "…"
          }
        />
        <Tile
          icon={<Coins className="h-4 w-4" />}
          label="ADA delegated"
          value={formatAda(stats.totalDelegatedAda)}
          hint="To these DReps"
        />
        <Tile
          icon={<FileText className="h-4 w-4" />}
          label="Recent proposals"
          value={formatNumber(stats.activeProposals)}
          hint="Latest 100"
        />
        <Tile
          icon={<Users className="h-4 w-4" />}
          label="Network"
          value={network === 0 ? "Preprod" : "Mainnet"}
          hint="From your wallet, if connected"
        />
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
