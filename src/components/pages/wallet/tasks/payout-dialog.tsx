import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);

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
    onError: (err) => setError({ message: err.message, retryable: false }),
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
      const code = err.data?.code;
      setError({
        message: err.message,
        // The tasks changed or the token expired: a fresh preview fixes it.
        retryable: code === "CONFLICT" || code === "PRECONDITION_FAILED" || code === "BAD_REQUEST",
      });
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" data-testid="payout-dialog">
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

        {!preview && !created && (
          <div className="grid gap-3">
            <ul className="divide-y rounded-md border text-sm" data-testid="payout-task-list">
              {tasks.map((task) => (
                <li key={task.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="truncate">{task.title}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatTotals(task.recipients, walletAssetMetadata).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Total: {formatTotals(tasks.flatMap((t) => t.recipients), walletAssetMetadata).join(" · ")}.
              The server builds the transaction against the wallet&apos;s spendable funds and shows it here
              before anything is created.
            </p>
          </div>
        )}

        {preview && !created && (
          <SummaryView summary={preview.summary} warnings={preview.warnings} expired={expired} expiresAt={preview.expiresAt} />
        )}

        {created && (
          <div className="flex flex-col items-center gap-3 py-4 text-center" data-testid="payout-created">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
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
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
            data-testid="payout-error"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>{error.message}</span>
          </div>
        )}

        <DialogFooter className="gap-2">
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
                disabled={busy || expired || (error !== null && !error.retryable && false)}
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

function AmountList({ amounts }: { amounts: ReviewAmount[] }) {
  return <span>{amounts.map((a) => a.display).join(" · ")}</span>;
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
    <div className="grid gap-3 text-sm" data-testid="payout-summary">
      <div className="rounded-md border">
        <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
          Recipients ({summary.recipients.length})
        </div>
        <ul className="divide-y">
          {summary.recipients.map((recipient) => (
            <li key={recipient.address} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                {recipient.label && <span className="mr-2 font-medium">{recipient.label}</span>}
                <span className="break-all font-mono text-xs text-muted-foreground">{recipient.address}</span>
              </span>
              <span className="shrink-0 font-medium">
                <AmountList amounts={recipient.amounts} />
              </span>
            </li>
          ))}
        </ul>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Fee</dt>
        <dd data-testid="payout-fee">{summary.fee?.display ?? "—"}</dd>
        <dt className="text-muted-foreground">Change to wallet</dt>
        <dd>{summary.change.length > 0 ? <AmountList amounts={summary.change} /> : "—"}</dd>
        <dt className="text-muted-foreground">Inputs</dt>
        <dd>{summary.inputs.count}</dd>
        <dt className="text-muted-foreground">Signatures needed</dt>
        <dd>
          {summary.threshold.required} of {summary.threshold.total}
        </dd>
        <dt className="text-muted-foreground">Description</dt>
        <dd className="break-words">{summary.description}</dd>
        <dt className="text-muted-foreground">Preview valid until</dt>
        <dd className={expired ? "text-destructive" : ""}>
          {new Date(expiresAt).toLocaleTimeString()}
          {expired && " (expired — preview again)"}
        </dd>
      </dl>
      {warnings.length > 0 && (
        <ul className="list-disc rounded-md border border-amber-500/40 bg-amber-500/10 py-2 pl-7 pr-3 text-xs">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
