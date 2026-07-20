import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Papa from "papaparse";
import {
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  FileText,
  Loader,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import SectionTitle from "@/components/ui/section-title";
import GovernanceTypeChip from "@/components/pages/wallet/governance/gov-type-chip";
import { toast } from "@/hooks/use-toast";
import { extractCidPath, fetchIpfsJson, ipfsGatewayUrl } from "@/lib/ipfs";
import { extractJsonLdValue } from "@/utils/jsonLdParser";
import type {
  DrepVoteHistoryItem,
  DrepVoteHistoryResponse,
} from "@/types/governance";

/**
 * Explorable vote history for a DRep: every governance action they voted on,
 * with the on-chain rationale (CIP-100 comment / CIP-136 summary + statement)
 * resolved lazily from the vote's anchor, plus a CSV download of the lot.
 */

const CSV_HEADERS = [
  "proposal_id",
  "proposal_title",
  "proposal_type",
  "vote",
  "vote_date",
  "rationale",
  "anchor_url",
  "anchor_hash",
  "vote_tx_hash",
] as const;

type VoteFilter = "All" | DrepVoteHistoryItem["vote"];

type RationaleState =
  | { status: "loading" }
  | { status: "done"; text: string }
  | { status: "error" };

const VOTE_BADGE_CLASSES: Record<DrepVoteHistoryItem["vote"], string> = {
  Yes: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
  No: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300",
  Abstain:
    "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300",
};

function VoteBadge({ vote }: { vote: DrepVoteHistoryItem["vote"] }) {
  return (
    <Badge variant="outline" className={`font-medium ${VOTE_BADGE_CLASSES[vote]}`}>
      {vote}
    </Badge>
  );
}

/**
 * Pull the human-readable rationale out of an anchor document. CIP-100 vote
 * anchors carry `body.comment`; CIP-136 ones `body.summary` and
 * `body.rationaleStatement`. Values may be JSON-LD `{"@value": …}` wrappers.
 */
function parseRationaleText(doc: unknown): string {
  const body = (doc as { body?: Record<string, unknown> } | null)?.body;
  if (!body || typeof body !== "object") return "";
  const parts = [
    extractJsonLdValue(body.comment, ""),
    extractJsonLdValue(body.summary, ""),
    extractJsonLdValue(body.rationaleStatement, ""),
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(parts)].join("\n\n");
}

/** Human-openable link for an anchor: http(s) as-is, IPFS via a gateway. */
function anchorHref(metaUrl: string): string | undefined {
  if (metaUrl.startsWith("http")) return metaUrl;
  const cidPath = extractCidPath(metaUrl);
  return cidPath ? ipfsGatewayUrl(cidPath) : undefined;
}

function govToolActionUrl(item: DrepVoteHistoryItem, network: number): string {
  const host = network === 0 ? "preprod.gov.tools" : "gov.tools";
  return `https://${host}/governance_actions/${item.proposalTxHash}#${item.proposalIndex}`;
}

function formatVoteDate(blockTime: number): string {
  return new Date(blockTime * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function VoteHistory({
  drepId,
  network,
  embedded = false,
}: {
  drepId: string;
  network: number;
  /** Render without the page-level section title (the host supplies its own heading). */
  embedded?: boolean;
}) {
  const [votes, setVotes] = useState<DrepVoteHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [voteFilter, setVoteFilter] = useState<VoteFilter>("All");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);

  // Rationale cache keyed by anchor URL, so votes sharing an anchor share one
  // fetch and votes in the same tx with different anchors never collide. The
  // ref mirrors the state so export/lazy-load callbacks read the latest.
  const [rationales, setRationales] = useState<Record<string, RationaleState>>({});
  const rationalesRef = useRef(rationales);
  const inflight = useRef(new Map<string, Promise<string>>());

  const setRationale = useCallback((key: string, value: RationaleState) => {
    setRationales((prev) => {
      const next = { ...prev, [key]: value };
      rationalesRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    // The parent page resolves the network from the connected wallet; until
    // then it holds the sentinel value 3 — don't fire a doomed request.
    if (!drepId || (network !== 0 && network !== 1)) return;
    let aborted = false;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    fetch(
      `/api/governance/drepVotes?drepId=${encodeURIComponent(drepId)}&network=${network}`,
      { signal: controller.signal },
    )
      .then((res) => {
        if (!res.ok) throw new Error(`Vote history request failed (${res.status})`);
        return res.json() as Promise<DrepVoteHistoryResponse>;
      })
      .then((data) => {
        if (!aborted) setVotes(data.votes ?? []);
      })
      .catch((err: unknown) => {
        if (!aborted && (err as Error)?.name !== "AbortError") setError(true);
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
      controller.abort();
    };
  }, [drepId, network, reloadKey]);

  const loadRationale = useCallback(
    (item: DrepVoteHistoryItem): Promise<string> => {
      if (!item.metaUrl) return Promise.resolve("");
      const key = item.metaUrl;
      const cached = rationalesRef.current[key];
      if (cached?.status === "done") return Promise.resolve(cached.text);
      const running = inflight.current.get(key);
      if (running) return running;

      setRationale(key, { status: "loading" });
      const promise = fetchIpfsJson(item.metaUrl)
        .then((doc) => {
          const text = parseRationaleText(doc);
          setRationale(key, { status: "done", text });
          return text;
        })
        .catch((err: unknown) => {
          setRationale(key, { status: "error" });
          inflight.current.delete(key); // allow a retry on next expand
          throw err;
        });
      inflight.current.set(key, promise);
      return promise;
    },
    [setRationale],
  );

  const counts = useMemo(() => {
    const c = { Yes: 0, No: 0, Abstain: 0 };
    for (const v of votes) c[v.vote]++;
    return c;
  }, [votes]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return votes.filter((v) => {
      if (voteFilter !== "All" && v.vote !== voteFilter) return false;
      if (!needle) return true;
      return (
        (v.proposalTitle ?? "").toLowerCase().includes(needle) ||
        v.proposalId.toLowerCase().includes(needle) ||
        (v.proposalType ?? "").replace(/_/g, " ").includes(needle)
      );
    });
  }, [votes, voteFilter, search]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      // Resolve every rationale (bounded concurrency) so the CSV carries the
      // text, not just anchor URLs. Already-viewed rows come from the cache.
      const queue = votes.filter((v) => v.metaUrl);
      let failed = 0;
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (queue.length > 0) {
            const item = queue.shift();
            if (!item) break;
            try {
              await loadRationale(item);
            } catch {
              failed++;
            }
          }
        }),
      );

      const rows = votes.map((v) => {
        const cached = v.metaUrl ? rationalesRef.current[v.metaUrl] : undefined;
        return {
          proposal_id: v.proposalId,
          proposal_title: v.proposalTitle ?? "",
          proposal_type: v.proposalType ?? "",
          vote: v.vote,
          vote_date: new Date(v.blockTime * 1000).toISOString(),
          rationale: cached?.status === "done" ? cached.text : "",
          anchor_url: v.metaUrl ?? "",
          anchor_hash: v.metaHash ?? "",
          vote_tx_hash: v.voteTxHash,
        };
      });
      const csv = Papa.unparse({ fields: [...CSV_HEADERS], data: rows });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `${drepId}-vote-history.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "Vote history exported",
        description:
          `${rows.length} vote${rows.length === 1 ? "" : "s"} exported` +
          (failed > 0
            ? `; ${failed} rationale${failed === 1 ? "" : "s"} could not be resolved.`
            : "."),
      });
    } finally {
      setExporting(false);
    }
  }, [votes, drepId, loadRationale]);

  if (network !== 0 && network !== 1) return null;

  return (
    <section className="flex flex-col gap-4">
      {!embedded && <SectionTitle>Vote History</SectionTitle>}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader className="h-4 w-4 animate-spin" />
          <span>Loading vote history…</span>
        </div>
      ) : error ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>Could not load the vote history.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            Retry
          </Button>
        </div>
      ) : votes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This DRep has not voted on any governance actions yet.
        </p>
      ) : (
        <>
          {/* Controls: filter chips, search, export */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ["All", votes.length],
                  ["Yes", counts.Yes],
                  ["No", counts.No],
                  ["Abstain", counts.Abstain],
                ] as [VoteFilter, number][]
              ).map(([value, count]) => (
                <Button
                  key={value}
                  variant={voteFilter === value ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setVoteFilter(value)}
                >
                  {value}
                  <span className="ml-1 text-muted-foreground">{count}</span>
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search proposals…"
                  className="h-8 w-48 pl-7 text-xs sm:w-56"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => void handleExport()}
                disabled={exporting}
                title="Download the full vote history, including rationales, as CSV"
              >
                {exporting ? (
                  <Loader className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Export CSV
              </Button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No votes match the current filter.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {filtered.map((v) => (
                <VoteRow
                  key={`${v.voteTxHash}:${v.proposalId}`}
                  item={v}
                  network={network}
                  rationale={v.metaUrl ? rationales[v.metaUrl] : undefined}
                  onExpand={() => {
                    loadRationale(v).catch(() => {
                      // surfaced inline via the row's error state
                    });
                  }}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function VoteRow({
  item,
  network,
  rationale,
  onExpand,
}: {
  item: DrepVoteHistoryItem;
  network: number;
  rationale: RationaleState | undefined;
  onExpand: () => void;
}) {
  const [open, setOpen] = useState(false);
  const href = item.metaUrl ? anchorHref(item.metaUrl) : undefined;

  return (
    <li className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {item.proposalType && (
              <GovernanceTypeChip governanceType={item.proposalType} />
            )}
            <span className="text-xs text-muted-foreground">
              {formatVoteDate(item.blockTime)}
            </span>
          </div>
          <a
            href={govToolActionUrl(item, network)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 flex items-center gap-1 text-sm font-medium text-foreground hover:underline"
            title={item.proposalId}
          >
            <span className="truncate">
              {item.proposalTitle ?? item.proposalId}
            </span>
            <ExternalLink className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
          </a>
        </div>
        <VoteBadge vote={item.vote} />
      </div>

      {item.metaUrl ? (
        <Collapsible
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (next) onExpand();
          }}
          className="mt-2"
        >
          <div className="flex items-center gap-2">
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
              <FileText className="h-3 w-3" />
              <span className="font-medium">Rationale</span>
              {open ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </CollapsibleTrigger>
            {href && (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                <span>source</span>
              </a>
            )}
          </div>
          <CollapsibleContent className="mt-1.5">
            {rationale?.status === "done" ? (
              rationale.text ? (
                <p className="whitespace-pre-wrap rounded-md border border-border/50 bg-muted/30 p-2 text-xs text-foreground/90">
                  {rationale.text}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No rationale text found in the anchor document.
                </p>
              )
            ) : rationale?.status === "error" ? (
              <p className="text-xs text-muted-foreground">
                Could not load the rationale from its anchor.
              </p>
            ) : (
              // Expanding always kicks off a load, so no-state means loading.
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader className="h-3 w-3 animate-spin" />
                <span>Loading rationale…</span>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          No rationale attached to this vote.
        </p>
      )}
    </li>
  );
}
