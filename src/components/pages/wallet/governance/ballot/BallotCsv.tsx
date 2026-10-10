import { useCallback } from "react";
import Papa from "papaparse";
import { useDropzone } from "react-dropzone";
import { Download, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/utils/api";
import { toast } from "@/hooks/use-toast";
import type { BallotType } from "./ballot";

/**
 * CSV import/export for a ballot. The CSV columns are:
 *   proposal_id, title, vote, comment, anchor_url, anchor_hash
 *
 * Export uses Papa.unparse so commas / newlines inside rationale comments are
 * quoted correctly. Import merges by `proposal_id`: existing proposals are
 * updated in place, unseen ones are appended — proposals already in the ballot
 * but absent from the CSV are preserved. For an existing proposal a blank CSV
 * cell leaves that field unchanged (including the vote), so a CSV that only
 * fills in, say, anchor_url won't reset votes. Newly-appended proposals default
 * to an Abstain vote when their vote cell is blank.
 */

const CSV_HEADERS = [
  "proposal_id",
  "title",
  "vote",
  "comment",
  "anchor_url",
  "anchor_hash",
] as const;

function normalizeVote(value: string | undefined): "Yes" | "No" | "Abstain" {
  const s = (value ?? "").trim().toLowerCase();
  if (s === "yes" || s === "y") return "Yes";
  if (s === "no" || s === "n") return "No";
  return "Abstain";
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return cleaned || "ballot";
}

export default function BallotCsv({
  ballot,
  ballotId,
  onImported,
}: {
  ballot: BallotType;
  ballotId: string;
  onImported?: () => void | Promise<unknown>;
}) {
  const updateBallot = api.ballot.updateBallot.useMutation();

  const handleExport = useCallback(() => {
    const rows = ballot.items.map((proposalId, i) => ({
      proposal_id: proposalId ?? "",
      title: ballot.itemDescriptions?.[i] ?? "",
      vote: ballot.choices?.[i] ?? "Abstain",
      comment: ballot.rationaleComments?.[i] ?? "",
      anchor_url: ballot.anchorUrls?.[i] ?? "",
      anchor_hash: ballot.anchorHashes?.[i] ?? "",
    }));
    const csv = Papa.unparse({ fields: [...CSV_HEADERS], data: rows });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${sanitizeFilename(ballot.description ?? "ballot")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [ballot]);

  const onDrop = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (!file) return;
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toLowerCase(),
        complete: (results) => {
          void (async () => {
            try {
              const items = [...ballot.items];
              const itemDescriptions = [...(ballot.itemDescriptions ?? [])];
              const choices = [...(ballot.choices ?? [])];
              const anchorUrls = [...(ballot.anchorUrls ?? [])];
              const anchorHashes = [...(ballot.anchorHashes ?? [])];
              const rationaleComments = [...(ballot.rationaleComments ?? [])];

              let added = 0;
              let updated = 0;
              let skipped = 0;

              for (const row of results.data) {
                const proposalId = (row.proposal_id ?? row.proposalid ?? "").trim();
                if (!proposalId) {
                  skipped++;
                  continue;
                }
                const title = (row.title ?? "").trim();
                const voteRaw = (row.vote ?? "").trim();
                const comment = (row.comment ?? "").trim();
                const anchorUrl = (row.anchor_url ?? row.anchorurl ?? "").trim();
                const anchorHash = (row.anchor_hash ?? row.anchorhash ?? "").trim();

                const idx = items.indexOf(proposalId);
                if (idx >= 0) {
                  // Update in place; a blank cell leaves the existing value intact,
                  // including the vote (so anchor-only CSVs don't reset choices).
                  if (title) itemDescriptions[idx] = title;
                  if (voteRaw) choices[idx] = normalizeVote(voteRaw);
                  if (comment) rationaleComments[idx] = comment;
                  if (anchorUrl) anchorUrls[idx] = anchorUrl;
                  if (anchorHash) anchorHashes[idx] = anchorHash;
                  updated++;
                } else {
                  // New proposal: a blank vote cell defaults to Abstain.
                  items.push(proposalId);
                  itemDescriptions.push(title);
                  choices.push(normalizeVote(voteRaw));
                  rationaleComments.push(comment);
                  anchorUrls.push(anchorUrl);
                  anchorHashes.push(anchorHash);
                  added++;
                }
              }

              if (added === 0 && updated === 0) {
                toast({
                  title: "Nothing imported",
                  description: "No rows with a proposal_id were found. Check the CSV header.",
                  variant: "destructive",
                });
                return;
              }

              await updateBallot.mutateAsync({
                ballotId,
                items,
                itemDescriptions,
                choices,
                anchorUrls,
                anchorHashes,
                rationaleComments,
                type: ballot.type,
              });
              await onImported?.();
              toast({
                title: "Ballot imported",
                description: `${added} added, ${updated} updated${skipped ? `, ${skipped} skipped` : ""}.`,
              });
            } catch (error) {
              toast({
                title: "Import failed",
                description: error instanceof Error ? error.message : "Could not import CSV.",
                variant: "destructive",
              });
            }
          })();
        },
        error: (error) => {
          toast({
            title: "Parse error",
            description: error.message,
            variant: "destructive",
          });
        },
      });
    },
    [ballot, ballotId, updateBallot, onImported],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { "text/csv": [".csv"] },
    multiple: false,
    noClick: true,
    noKeyboard: true,
  });

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
          Import / export ballot as CSV
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={open}
            disabled={updateBallot.isPending}
          >
            {updateBallot.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Import CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleExport}
            disabled={ballot.items.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      </div>
      <div
        {...getRootProps()}
        className={`flex items-center justify-center rounded-md border-2 border-dashed px-3 py-2 text-center text-xs transition-colors ${
          isDragActive
            ? "border-blue-400 bg-blue-50/60 dark:border-blue-500 dark:bg-blue-950/20"
            : "border-muted-foreground/30 hover:bg-muted/40"
        }`}
      >
        <input {...getInputProps()} />
        <span className="text-muted-foreground">
          {isDragActive
            ? "Drop the CSV here…"
            : "Drag & drop a CSV, or use Import. Columns: proposal_id, title, vote, comment, anchor_url, anchor_hash"}
        </span>
      </div>
    </div>
  );
}
