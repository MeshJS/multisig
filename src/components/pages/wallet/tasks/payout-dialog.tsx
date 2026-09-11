import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import RowLabelInfo from "@/components/ui/row-label-info";
import { useToast } from "@/hooks/use-toast";
import { useWalletsStore } from "@/lib/zustand/wallets";
import type { ReviewAmount, TxReviewSummary } from "@/lib/tx-review/summary";
import { api } from "@/utils/api";

import { formatTotals } from "./board-model";
import type { BoardTask, PayoutConfirmation, PayoutPreview } from "./types";

/**
 * Prepare a payout for the selected tasks: preview (server builds the
 * unsigned transaction, returns the summary and a draft token) → the human
 * reads recipients, fee and warnings → confirm (the token, nothing else) →
 * a pending transaction with zero signatures, tasks linked.
 *
 * The summary is the same model the MCP review card is drawn from; here it
 * is rendered as HTML.
 */
export default function PayoutDialog({
  open,
  onOpenChange,
  walletId,
  tasks,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walletId: string;
  tasks: BoardTask[];
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const utils = api.useUtils();
  const walletAssetMetadata = useWalletsStore((s) => s.walletAssetMetadata);
  const [preview, setPreview] = useState<PayoutPreview | null>(null);
  const [created, setCreated] = useState<PayoutConfirmation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setCreated(null);
    setError(null);
  }, [open]);

  const prepare = api.task.preparePayout.useMutation({
    onSuccess: (data) => {
      setError(null);
      setPreview(data);
    },
    onError: (err) => setError(err.message),
  });
  const confirm = api.task.confirmPayout.useMutation({
    onSuccess: (data) => {
      setCreated(data);
      void utils.task.list.invalidate({ walletId });
      void utils.transaction.getPendingTransactions.invalidate({ walletId });
      toast({
        title: data.alreadyExisted ? "Payout already created" : "Payout created for signers",
        description: "It has no signatures yet. Sign it on the Transactions page.",
      });
      onCreated();
    },
    onError: (err) => {
      // The tasks changed or the token expired: a fresh preview fixes it.
      setError(err.message);
      void utils.task.list.invalidate({ walletId });
    },
  });

  const busy = prepare.isPending || confirm.isPending;
  const expired = preview ? new Date(preview.expiresAt).getTime() < Date.now() : false;

  function runPreview() {
    setError(null);
    setPreview(null);
    prepare.mutate({ walletId, taskIds: tasks.map((t) => t.id) });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[520px]" data-testid="payout-dialog">
        <DialogHeader>
          <DialogTitle>
            {created ? "Payout created" : preview ? "Review payout" : "Prepare payout"}
          </DialogTitle>
          <DialogDescription>
            {created
              ? "The pending transaction is waiting for signatures."
              : preview
                ? "This is exactly what will be created. Nothing is signed or sent."
                : `One transaction paying ${tasks.length === 1 ? "this task's" : `${tasks.length} tasks'`} recipients.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {!preview && !created && (
            <>
              <div className="space-y-2 rounded-lg border border-border/50 bg-muted/30 p-3" data-testid="payout-task-list">
                {tasks.map((task) => (
                  <div key={task.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{task.title}</span>
                    <span className="shrink-0 font-medium">
                      {formatTotals(task.recipients, walletAssetMetadata).join(" · ")}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-sm">
                <span className="font-medium">Total:</span>{" "}
                {formatTotals(tasks.flatMap((t) => t.recipients), walletAssetMetadata).join(" · ")}
              </p>
              <p className="text-xs text-muted-foreground">
                The server builds the transaction against the wallet&apos;s spendable funds and shows it here
                before anything is created.
              </p>
            </>
          )}

          {preview && !created && (
            <SummaryView summary={preview.summary} warnings={preview.warnings} expired={expired} expiresAt={preview.expiresAt} />
          )}

          {created && (
            <div className="flex flex-col items-center gap-3 py-4 text-center" data-testid="payout-created">
              <CheckCircle2 className="h-10 w-10 text-green-500 dark:text-green-400" />
              <p className="text-sm">
                Transaction created with no signatures. Every signer has been notified; the tasks show as
                awaiting signatures until the threshold is reached.
              </p>
              {created.txHashChanged && (
                <p className="text-xs text-muted-foreground">
                  Inputs were re-selected since the preview ({created.txHashChangeReasons.join(", ")}); recipients and
                  amounts are unchanged.
                </p>
              )}
            </div>
          )}

          {error && (
            <div
              className="w-full rounded-lg border border-destructive/20 bg-destructive/5 p-3 sm:p-4"
              data-testid="payout-error"
            >
              <div className="flex items-center gap-2 text-destructive">
                <X className="h-4 w-4 flex-shrink-0" />
                <span className="text-sm font-medium">
                  {preview ? "Could not create the payout" : "Could not prepare the payout"}
                </span>
              </div>
              <p className="mt-1 break-words text-sm text-destructive/80">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          {created ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button asChild data-testid="payout-open-transactions">
                <Link href={`/wallets/${walletId}/transactions#tx-${created.transactionId}`}>Go to Transactions</Link>
              </Button>
            </>
          ) : preview ? (
            <>
              <Button variant="outline" disabled={busy} onClick={runPreview}>
                Preview again
              </Button>
              <Button
                disabled={busy || expired}
                onClick={() => confirm.mutate({ draftToken: preview.draftToken })}
                data-testid="payout-confirm-button"
              >
                {confirm.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create for signers
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={busy || tasks.length === 0} onClick={runPreview} data-testid="payout-preview-button">
                {prepare.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Preview payout
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function amountText(amounts: ReviewAmount[]): string {
  return amounts.map((a) => a.display).join(" · ");
}

function SummaryView({
  summary,
  warnings,
  expired,
  expiresAt,
}: {
  summary: TxReviewSummary;
  warnings: string[];
  expired: boolean;
  expiresAt: string;
}) {
  return (
    <div className="grid gap-4" data-testid="payout-summary">
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recipients ({summary.recipients.length})
        </div>
        <div className="space-y-2 rounded-lg border border-border/50 bg-muted/30 p-3">
          {summary.recipients.map((recipient) => (
            <div key={recipient.address} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                {recipient.label && <span className="mr-2 font-medium">{recipient.label}</span>}
                <span className="break-all font-mono text-xs text-muted-foreground">{recipient.address}</span>
              </span>
              <span className="shrink-0 font-medium">{amountText(recipient.amounts)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <RowLabelInfo label="Fee" value={<span data-testid="payout-fee">{summary.fee?.display ?? "—"}</span>} />
        <RowLabelInfo label="Change" value={summary.change.length > 0 ? amountText(summary.change) : "—"} />
        <RowLabelInfo label="Inputs" value={String(summary.inputs.count)} />
        <RowLabelInfo label="Signatures" value={`${summary.threshold.required} of ${summary.threshold.total}`} />
        <RowLabelInfo label="Description" value={summary.description} allowOverflow />
        <RowLabelInfo
          label="Valid until"
          value={`${new Date(expiresAt).toLocaleTimeString()}${expired ? " (expired — preview again)" : ""}`}
          className={expired ? "text-sm text-destructive" : undefined}
        />
      </div>
      {warnings.length > 0 && (
        <ul className="list-disc rounded-md border border-warning/50 bg-warning/10 py-2 pl-7 pr-3 text-xs">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
