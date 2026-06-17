import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import WalletBalance from "@/components/pages/homepage/wallets/WalletBalance";
import { GovernanceTypeChip } from "@/components/pages/wallet/governance/gov-type-chip";
import ActiveIndicator from "@/components/pages/homepage/governance/drep/activeIndicator";
import ScriptIndicator from "@/components/pages/homepage/governance/drep/scriptIndicator";
import {
  Wallet,
  ShieldCheck,
  Check,
  Clock,
  Send,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  TrendingUp,
} from "lucide-react";

/**
 * Live, mock-data-filled previews of the product's real UI, used on the landing
 * page in place of static screenshots. They are built from the same design-system
 * primitives (`@/components/ui/*`) and a few genuinely-presentational app
 * components (`WalletBalance`, `GovernanceTypeChip`, `ActiveIndicator`,
 * `ScriptIndicator`) — so they automatically track the app's look (tokens,
 * fonts, dark mode, badge/card styles) instead of going stale like a PNG.
 *
 * Everything here is decorative: the frames are `aria-hidden` and the mock
 * buttons are inert (`pointer-events-none`). The surrounding feature card's
 * heading/description carry the real meaning for assistive tech and SEO.
 */

/** Faux "app window" frame that makes a preview read as a product screenshot. */
function PreviewFrame({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card/80 shadow-sm backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-border/60 bg-muted/40 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/60" />
        {label && (
          <span className="ml-2 truncate text-[11px] font-medium text-muted-foreground">
            {label}
          </span>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Avatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-200 to-zinc-300 text-[10px] font-semibold text-zinc-700 dark:from-zinc-700 dark:to-zinc-800 dark:text-zinc-200",
        className,
      )}
    >
      {initials}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}

const verifiedBadge =
  "gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300";
const pendingBadge =
  "gap-1 border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300";

/* --- Multi-signature wallet ------------------------------------------------ */
export function MultisigWalletPreview() {
  return (
    <PreviewFrame label="Treasury · Core Team">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-semibold">Core Team Treasury</span>
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            addr1q9x…m4f3k8
          </p>
        </div>
        <Badge variant="secondary" className="gap-1 whitespace-nowrap">
          <ShieldCheck className="h-3 w-3" />2 of 3
        </Badge>
      </div>
      <div className="mt-4">
        <WalletBalance balance={128450} loadingState="loaded" />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge variant="outline" className="font-mono text-[10px]">₳ 128,450</Badge>
        <Badge variant="outline" className="font-mono text-[10px]">MESH 12,000</Badge>
        <Badge variant="outline" className="font-mono text-[10px]">iUSD 5,400</Badge>
      </div>
      <Separator className="my-3" />
      <div className="flex items-center justify-between">
        <div className="flex -space-x-1.5">
          <Avatar initials="AB" />
          <Avatar initials="CD" />
          <Avatar initials="EF" />
        </div>
        <span className="text-xs text-muted-foreground">3 signers</span>
      </div>
    </PreviewFrame>
  );
}

/* --- Manage all your wallets ----------------------------------------------- */
const wallets = [
  { name: "Core Team Treasury", threshold: "2 of 3", balance: "₳ 128,450" },
  { name: "Grants Multisig", threshold: "3 of 5", balance: "₳ 64,900" },
  { name: "Marketing", threshold: "2 of 4", balance: "₳ 12,300" },
];

export function WalletListPreview() {
  return (
    <PreviewFrame label="Your wallets">
      <div className="space-y-2">
        {wallets.map((w) => (
          <div
            key={w.name}
            className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 p-2.5"
          >
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-muted">
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{w.name}</p>
              <p className="text-[10px] text-muted-foreground">{w.threshold} signers</p>
            </div>
            <span className="whitespace-nowrap font-mono text-xs font-semibold">
              {w.balance}
            </span>
          </div>
        ))}
      </div>
    </PreviewFrame>
  );
}

/* --- Invite & verify signers ----------------------------------------------- */
const signers = [
  { initials: "AB", name: "alice.ada", addr: "addr1q9x…m4f3k8", verified: true },
  { initials: "CD", name: "bob.cardano", addr: "addr1qy7…k2p9z1", verified: true },
  { initials: "EF", name: "carol", addr: "addr1qz3…h8t6w0", verified: false },
];

export function SignersPreview() {
  return (
    <PreviewFrame label="Signers">
      <div className="space-y-2">
        {signers.map((s) => (
          <div
            key={s.name}
            className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 p-2.5"
          >
            <Avatar initials={s.initials} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{s.name}</p>
              <p className="truncate font-mono text-[10px] text-muted-foreground">{s.addr}</p>
            </div>
            {s.verified ? (
              <Badge variant="outline" className={verifiedBadge}>
                <Check className="h-3 w-3" />Verified
              </Badge>
            ) : (
              <Badge variant="outline" className={pendingBadge}>
                <Clock className="h-3 w-3" />Pending
              </Badge>
            )}
          </div>
        ))}
      </div>
    </PreviewFrame>
  );
}

/* --- Create new transaction ------------------------------------------------ */
export function CreateTransactionPreview() {
  return (
    <PreviewFrame label="New transaction">
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Recipient
          </p>
          <div className="rounded-md border border-border/60 bg-background/40 px-2.5 py-2 font-mono text-xs text-muted-foreground">
            addr1qy7…k2p9z1
          </div>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Amount
          </p>
          <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-2.5 py-2 text-sm font-semibold">
            ₳ 5,000.00
            <span className="text-xs font-normal text-muted-foreground">ADA</span>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
          Requires 2 of 3 signatures
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="pointer-events-none flex-1">
            <Send className="mr-1.5 h-3.5 w-3.5" />Create &amp; sign
          </Button>
          <Button size="sm" variant="outline" className="pointer-events-none">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </PreviewFrame>
  );
}

/* --- Transaction history --------------------------------------------------- */
const history = [
  { dir: "out", label: "Sent · vendor payout", amount: "−₳ 5,000", date: "2d ago" },
  { dir: "in", label: "Received · grant", amount: "+₳ 18,200", date: "5d ago" },
  { dir: "out", label: "Sent · payroll", amount: "−₳ 1,250", date: "1w ago" },
] as const;

export function TransactionHistoryPreview() {
  return (
    <PreviewFrame label="Transactions">
      <div className="space-y-1.5">
        {history.map((tx) => (
          <div
            key={tx.label}
            className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-2.5 py-2"
          >
            <span
              className={cn(
                "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full",
                tx.dir === "in"
                  ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400"
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
              )}
            >
              {tx.dir === "in" ? (
                <ArrowDownLeft className="h-3.5 w-3.5" />
              ) : (
                <ArrowUpRight className="h-3.5 w-3.5" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{tx.label}</p>
              <p className="text-[10px] text-muted-foreground">{tx.date}</p>
            </div>
            <span
              className={cn(
                "whitespace-nowrap font-mono text-xs font-semibold",
                tx.dir === "in" ? "text-emerald-600 dark:text-emerald-400" : "",
              )}
            >
              {tx.amount}
            </span>
            <Badge variant="outline" className={verifiedBadge}>
              <Check className="h-3 w-3" />
            </Badge>
          </div>
        ))}
      </div>
    </PreviewFrame>
  );
}

/* --- Pending transactions -------------------------------------------------- */
const pending = [
  { title: "Payroll · March", signed: 2, total: 3 },
  { title: "Ecosystem grant", signed: 1, total: 3 },
];

export function PendingTransactionsPreview() {
  return (
    <PreviewFrame label="Pending">
      <div className="space-y-3">
        {pending.map((p) => (
          <div
            key={p.title}
            className="rounded-lg border border-border/60 bg-background/40 p-3"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">{p.title}</p>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                {p.signed} of {p.total} signed
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground/70"
                style={{ width: `${(p.signed / p.total) * 100}%` }}
              />
            </div>
            <div className="mt-2 flex -space-x-1.5">
              {Array.from({ length: p.total }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-5 w-5 rounded-full border-2 border-card",
                    i < p.signed
                      ? "bg-emerald-400 dark:bg-emerald-500"
                      : "bg-muted-foreground/30",
                  )}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </PreviewFrame>
  );
}

/* --- Governance proposal --------------------------------------------------- */
function VoteBar({ label, pct, barClass }: { label: string; pct: number; barClass: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-[10px] text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", barClass)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-[10px] tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}

export function ProposalPreview() {
  return (
    <PreviewFrame label="Governance · Proposal">
      <p className="text-sm font-semibold leading-snug">
        Increase Treasury Withdrawal Cap
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <GovernanceTypeChip governanceType="treasury_withdrawals" />
        <Badge variant="outline" className={verifiedBadge}>
          <Check className="h-3 w-3" />Voted Yes
        </Badge>
      </div>
      <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">
        Allocate 2M ₳ from the treasury to fund the next wave of open-source tooling
        and audits for the Cardano ecosystem.
      </p>
      <div className="mt-3 space-y-1.5">
        <VoteBar label="Yes" pct={62} barClass="bg-emerald-500" />
        <VoteBar label="No" pct={24} barClass="bg-red-500" />
        <VoteBar label="Abstain" pct={14} barClass="bg-zinc-400" />
      </div>
    </PreviewFrame>
  );
}

/* --- Register / explore DRep ----------------------------------------------- */
export function DRepPreview() {
  return (
    <PreviewFrame label="Delegated Representative">
      <TooltipProvider delayDuration={0}>
        <div className="flex items-center gap-3">
          <Avatar initials="MJ" className="h-10 w-10 text-xs" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">MeshJS Collective</span>
              <ActiveIndicator isActive={true} />
              <ScriptIndicator hasScript={true} />
            </div>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              drep1q9x…m4f3k8
            </p>
          </div>
        </div>
        <Separator className="my-3" />
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Voting power" value="₳ 12.4M" />
          <Stat label="Delegators" value="1,284" />
        </div>
        <Button size="sm" variant="outline" className="pointer-events-none mt-3 w-full">
          Delegate
        </Button>
      </TooltipProvider>
    </PreviewFrame>
  );
}

/* --- Staking & delegation -------------------------------------------------- */
export function StakingPreview() {
  return (
    <PreviewFrame label="Staking">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar initials="MS" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">[MESH] Mesh Stake Pool</p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">pool1xyz…</p>
          </div>
        </div>
        <Badge variant="outline" className={verifiedBadge}>~3.1% APY</Badge>
      </div>
      <Separator className="my-3" />
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Delegated" value="₳ 128,450" />
        <Stat label="Rewards" value="₳ 842.17" />
      </div>
      <Button size="sm" variant="outline" className="pointer-events-none mt-3 w-full">
        <TrendingUp className="mr-1.5 h-3.5 w-3.5" />Withdraw rewards
      </Button>
    </PreviewFrame>
  );
}
