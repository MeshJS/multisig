import { useEffect, useMemo, useState } from "react";
import { FileText, Loader2, PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fetchIpfsJson } from "@/lib/ipfs";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import type { DraftVote } from "@/types/tx-draft";
import { api } from "@/utils/api";

/**
 * Per-vote rationale editor for the builder inspector. Shows the vote's
 * current rationale (from the wallet's ballots when cached, else fetched
 * from IPFS) and lets the user edit it — or add one to an anchor-less vote.
 * Edits live on the draft as `rationaleEdit` and are only uploaded (new
 * CIP-100 doc + anchor) when the transaction is built; untouched rationales
 * keep their existing anchor byte-for-byte.
 */
export default function VoteRationaleEditor({
  walletId,
  vote,
}: {
  walletId: string;
  vote: DraftVote;
}) {
  const setVoteRationale = useTxBuilderStore(
    (state) => state.setVoteRationale,
  );
  const clearVoteAnchor = useTxBuilderStore((state) => state.clearVoteAnchor);

  const [expanded, setExpanded] = useState(false);
  const [fetched, setFetched] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Ballot-cached rationale: same query key as useProposalTitles, so this is
  // usually cache-hot and instant.
  const { data: ballots } = api.ballot.getByWallet.useQuery(
    { walletId },
    { enabled: !!walletId && !!vote.anchor, staleTime: 30 * 1000 },
  );
  const ballotComment = useMemo(() => {
    if (!vote.anchor) return undefined;
    for (const ballot of ballots ?? []) {
      const urls = ballot.anchorUrls ?? [];
      const hashes = ballot.anchorHashes ?? [];
      const comments = ballot.rationaleComments ?? [];
      const count = Math.max(urls.length, hashes.length, comments.length);
      for (let i = 0; i < count; i++) {
        const matches =
          (!!urls[i] && urls[i] === vote.anchor.anchorUrl) ||
          (!!hashes[i] && hashes[i] === vote.anchor.anchorDataHash);
        if (matches && comments[i]?.trim()) return comments[i]!.trim();
      }
    }
    return undefined;
  }, [ballots, vote.anchor]);

  // IPFS fallback, only once the editor is opened and the ballots had no
  // cached comment for this anchor.
  const anchorUrl = vote.anchor?.anchorUrl;
  useEffect(() => {
    if (!expanded || !anchorUrl || ballotComment !== undefined) return;
    if (fetched !== undefined || loading) return;
    let aborted = false;
    setLoading(true);
    setLoadError(false);
    fetchIpfsJson<{ body?: { comment?: string } }>(anchorUrl)
      .then((doc) => {
        if (!aborted) setFetched(doc?.body?.comment?.trim() ?? "");
      })
      .catch(() => {
        if (!aborted) setLoadError(true);
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [expanded, anchorUrl, ballotComment, fetched, loading]);

  // No anchor → there is no original text; editing starts from blank.
  const originalText = !vote.anchor
    ? ""
    : (ballotComment ?? (loadError ? undefined : fetched));

  const dirty = vote.rationaleEdit !== undefined;
  const displayedText = vote.rationaleEdit ?? originalText ?? "";
  const willRemove = dirty && vote.rationaleEdit!.trim() === "" && !!vote.anchor;

  function onChange(text: string) {
    // Typing back the exact original reverts the vote to untouched.
    setVoteRationale(vote.id, text === originalText ? undefined : text);
  }

  return (
    <div
      data-testid={`tx-builder-vote-rationale-${vote.id}`}
      className="flex flex-col gap-1"
    >
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <FileText className="h-3 w-3 shrink-0" />
        {vote.anchor ? (
          <span className="min-w-0 truncate" title={vote.anchor.anchorUrl}>
            {dirty
              ? "Rationale edited — will re-upload on build"
              : `Rationale attached — ${vote.anchor.anchorUrl}`}
          </span>
        ) : (
          <span className="min-w-0 truncate">
            {dirty && vote.rationaleEdit!.trim()
              ? "Rationale added — will upload on build"
              : "No rationale attached"}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-5 shrink-0 px-1.5 text-[10px]"
          data-testid={`tx-builder-vote-rationale-toggle-${vote.id}`}
          onClick={() => setExpanded((open) => !open)}
        >
          <PenLine className="mr-1 h-2.5 w-2.5" />
          {expanded ? "Done" : vote.anchor || dirty ? "Edit" : "Add rationale"}
        </Button>
        {vote.anchor && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 shrink-0 px-1.5 text-[10px]"
            title="Detach the rationale from the rebuilt vote"
            data-testid={`tx-builder-vote-clear-anchor-${vote.id}`}
            onClick={() => clearVoteAnchor(vote.id)}
          >
            Clear
          </Button>
        )}
      </div>
      {expanded && (
        <div className="flex flex-col gap-1">
          {loading ? (
            <div className="flex items-center gap-1.5 py-1 text-[10px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading current rationale...
            </div>
          ) : (
            <>
              {loadError && !dirty && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                  Couldn&apos;t load the existing rationale — saving new text
                  will replace it.
                </p>
              )}
              <Textarea
                data-testid={`tx-builder-vote-rationale-text-${vote.id}`}
                value={displayedText}
                placeholder="Why is the wallet voting this way?"
                className="min-h-[80px] text-xs"
                onChange={(event) => onChange(event.target.value)}
              />
              {dirty && (
                <div className="flex items-center justify-between gap-2">
                  <span
                    data-testid={`tx-builder-vote-rationale-dirty-${vote.id}`}
                    className="text-[10px] text-amber-600 dark:text-amber-400"
                  >
                    {willRemove
                      ? "Rationale will be removed when you build."
                      : "Edited — a new rationale document will be uploaded to IPFS when you build."}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 shrink-0 px-1.5 text-[10px]"
                    data-testid={`tx-builder-vote-rationale-revert-${vote.id}`}
                    onClick={() => setVoteRationale(vote.id, undefined)}
                  >
                    Revert
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
