import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import useProposalTitles from "@/hooks/useProposalTitles";
import {
  getProposalStatus,
  parseProposalId,
  type ProposalStatus,
} from "@/lib/governance";
import { useSiteStore } from "@/lib/zustand/site";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import type { ProposalDetails } from "@/types/governance";
import type { DraftVoteKind } from "@/types/tx-draft";
import { getProvider } from "@/utils/get-provider";
import { getFirstAndLast } from "@/utils/strings";

/** Matches useProposalTitles' MAX_TITLE_FETCHES so every row can get a title. */
const PAGE_SIZE = 10;

const VOTE_KIND_COLORS: Record<DraftVoteKind, string> = {
  Yes: "text-green-500 dark:text-green-400",
  No: "text-red-500 dark:text-red-400",
  Abstain: "text-muted-foreground",
};

const STATUS_LABELS: Record<ProposalStatus, string> = {
  active: "Active",
  enacted: "Enacted",
  dropped: "Dropped",
  expired: "Expired",
  ratified: "Ratified",
};

type ProposalListItem = {
  tx_hash: string;
  cert_index: number | string;
  governance_type: string;
  /**
   * Resolved from the per-proposal details endpoint — the list endpoint
   * doesn't carry the status epochs. undefined = still checking (row stays
   * disabled until the status is known).
   */
  status?: ProposalStatus;
};

/**
 * Adds a DRep vote to the draft: pick an ACTIVE governance action (browsed
 * from the chain, newest first, with non-active proposals shown but
 * disabled; manual txHash#index entries are status-checked on-chain) and an
 * explicit choice — the choice is never pre-selected, matching the vote
 * button's "never pre-arm a vote" principle. Confirming requires the
 * wallet's DRep to be registered. Rationale can be attached afterwards from
 * the vote's row in the inspector.
 */
export default function AddVoteDialog({
  open,
  onOpenChange,
  walletId,
  existingProposalIds,
  drepRegistered,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walletId: string;
  /** `${txHash}#${index}` of votes already in the draft. */
  existingProposalIds: string[];
  /** undefined = unknown or unregistered → notice shown, confirm disabled. */
  drepRegistered: boolean | undefined;
}) {
  const network = useSiteStore((state) => state.network);
  const addVote = useTxBuilderStore((state) => state.addVote);

  const [page, setPage] = useState(1);
  const [pageItems, setPageItems] = useState<ProposalListItem[] | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [voteKind, setVoteKind] = useState<DraftVoteKind | null>(null);
  const [manualId, setManualId] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualChecking, setManualChecking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPage(1);
    setSelectedId(null);
    setVoteKind(null);
    setManualId("");
    setManualError(null);
    setManualChecking(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setPageItems(null);
    setFetchFailed(false);
    let cancelled = false;
    const provider = getProvider(network);
    provider
      .get(`/governance/proposals?count=${PAGE_SIZE}&page=${page}&order=desc`)
      .then(async (data: ProposalListItem[]) => {
        if (cancelled) return;
        const items = Array.isArray(data) ? data : [];
        // Show the rows immediately (disabled, "Checking…") while their
        // statuses resolve — the list endpoint has no status fields.
        setPageItems(items);
        const withStatus = await Promise.all(
          items.map(async (item) => {
            try {
              const details = (await provider.get(
                `/governance/proposals/${item.tx_hash}/${item.cert_index}`,
              )) as ProposalDetails;
              return {
                ...item,
                status: getProposalStatus(details) ?? ("active" as const),
              };
            } catch {
              // Status unknown — the row stays disabled; the manual path
              // (which re-checks on-chain) remains available.
              return item;
            }
          }),
        );
        if (!cancelled) setPageItems(withStatus);
      })
      .catch(() => {
        if (!cancelled) {
          setPageItems([]);
          setFetchFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, network, page]);

  const pageIds = useMemo(
    () =>
      (pageItems ?? []).map((item) => `${item.tx_hash}#${item.cert_index}`),
    [pageItems],
  );
  const { resolveProposalTitle } = useProposalTitles(
    open ? walletId : undefined,
    pageIds,
  );

  /** Manual entries are checked on-chain so only active proposals pass. */
  async function selectManualId(raw: string) {
    const trimmed = raw.trim();
    let txHash: string;
    let certIndex: number;
    try {
      ({ txHash, certIndex } = parseProposalId(trimmed));
      if (!/^[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("bad hash");
    } catch {
      setManualError(
        "Invalid governance action id — expected <64-char tx hash>#<index>.",
      );
      return;
    }
    const id = `${txHash.toLowerCase()}#${certIndex}`;
    if (existingProposalIds.includes(id)) {
      setManualError("The draft already votes on this governance action.");
      return;
    }
    setManualChecking(true);
    try {
      const details = (await getProvider(network).get(
        `/governance/proposals/${txHash.toLowerCase()}/${certIndex}`,
      )) as ProposalDetails;
      const status = getProposalStatus(details) ?? "active";
      if (status !== "active") {
        setManualError(
          `This proposal is ${STATUS_LABELS[status].toLowerCase()} — only active proposals can be voted on.`,
        );
        return;
      }
      setSelectedId(id);
      setManualError(null);
    } catch {
      setManualError("Couldn't find this governance action on-chain.");
    } finally {
      setManualChecking(false);
    }
  }

  function onConfirm() {
    if (!selectedId || !voteKind || drepRegistered !== true) return;
    const { txHash, certIndex } = parseProposalId(selectedId);
    addVote({
      govActionTxHash: txHash,
      govActionIndex: certIndex,
      voteKind,
    });
    onOpenChange(false);
  }

  const confirmDisabledReason =
    drepRegistered !== true
      ? "The wallet's DRep must be registered before it can vote"
      : !selectedId
        ? "Pick a governance action first"
        : !voteKind
          ? "Pick Yes, No, or Abstain first"
          : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Header and footer stay pinned; only the middle scrolls, so the
          confirm button is never pushed out of view by the proposal list. */}
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add governance vote</DialogTitle>
          <DialogDescription>
            The vote is cast with this wallet&apos;s DRep identity and
            proposed to the signers when you build. A rationale can be added
            from the vote&apos;s row afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {drepRegistered === undefined && (
          <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs">
            This wallet&apos;s DRep doesn&apos;t appear to be registered —
            register it from the Governance page to enable voting.
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          {pageItems === null && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading proposals…
            </div>
          )}
          {pageItems !== null && pageItems.length === 0 && (
            <p className="py-2 text-sm text-muted-foreground">
              {fetchFailed
                ? "Couldn't load proposals — enter a governance action id below."
                : "No proposals on this page."}
            </p>
          )}
          {(pageItems ?? []).map((item) => {
            const id = `${item.tx_hash}#${item.cert_index}`;
            const inDraft = existingProposalIds.includes(id);
            // Only proposals confirmed active are votable; unknown status
            // (still checking, or the status fetch failed) stays disabled.
            const votable = item.status === "active" && !inDraft;
            const title = resolveProposalTitle(id);
            return (
              <button
                key={id}
                type="button"
                disabled={!votable}
                data-testid={`tx-builder-vote-proposal-${id}`}
                className={`flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-1.5 text-left text-xs ${
                  selectedId === id
                    ? "border-primary bg-primary/10"
                    : "border-border/50 hover:bg-muted/50"
                } ${votable ? "" : "opacity-50"}`}
                onClick={() => setSelectedId(id)}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">
                    {title ?? item.governance_type ?? "Governance action"}
                  </span>
                  <span
                    className={`shrink-0 rounded-full border border-border/50 px-1.5 py-0.5 text-[9px] font-medium ${
                      !inDraft && item.status === "active"
                        ? "text-green-500 dark:text-green-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {inDraft
                      ? "In draft"
                      : item.status
                        ? STATUS_LABELS[item.status]
                        : "Checking…"}
                  </span>
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {getFirstAndLast(item.tx_hash, 8, 4)}#{item.cert_index}
                </span>
              </button>
            );
          })}
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={page === 1 || pageItems === null}
              onClick={() => setPage((current) => current - 1)}
            >
              Previous
            </Button>
            <span className="text-[10px] text-muted-foreground">
              Page {page}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={
                pageItems === null || pageItems.length < PAGE_SIZE
              }
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Input
              data-testid="tx-builder-vote-manual-input"
              value={manualId}
              placeholder="Governance action id (txHash#index)"
              onChange={(event) => {
                setManualId(event.target.value);
                setManualError(null);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!manualId.trim() || manualChecking}
              data-testid="tx-builder-vote-manual-apply"
              onClick={() => void selectManualId(manualId)}
            >
              {manualChecking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Use"
              )}
            </Button>
          </div>
          {manualError && (
            <p className="text-xs text-red-500 dark:text-red-400">
              {manualError}
            </p>
          )}
        </div>
        </div>

        {/* Pinned below the scroll area with the footer, so the choice is
            always visible without scrolling. */}
        {selectedId && (
          <p className="text-xs">
            Voting on{" "}
            <span
              className="font-mono"
              data-testid="tx-builder-vote-selected"
              title={selectedId}
            >
              {getFirstAndLast(selectedId, 12, 8)}
            </span>
          </p>
        )}

        <div className="flex gap-2">
          {(["Yes", "No", "Abstain"] as const).map((kind) => (
            <Button
              key={kind}
              variant={voteKind === kind ? "default" : "outline"}
              size="sm"
              className={voteKind === kind ? "" : VOTE_KIND_COLORS[kind]}
              data-testid={`tx-builder-vote-kind-pick-${kind}`}
              onClick={() => setVoteKind(kind)}
            >
              {kind}
            </Button>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid="tx-builder-vote-confirm"
            disabled={!!confirmDisabledReason}
            title={confirmDisabledReason}
            onClick={onConfirm}
          >
            Add to transaction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
