import type { Transaction } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import usePendingEditor from "@/hooks/usePendingEditor";
import type { PendingEditorContext } from "@/lib/tx-draft/reconstruct-pending";
import type { ScriptInputProvider } from "@/lib/tx-draft/resolve-script-inputs";
import { dateToFormatted } from "@/utils/strings";

interface LoadPendingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingTransactions: Transaction[];
  requiredCount: number;
  onSelect: (transaction: Transaction) => void;
  context: PendingEditorContext;
  provider: ScriptInputProvider;
}

/**
 * Picker for editing an existing pending transaction in the builder. Only
 * supported transaction shapes can round-trip — incompatible transactions are
 * shown disabled with the reason.
 */
export default function LoadPendingDialog({
  open,
  onOpenChange,
  pendingTransactions,
  requiredCount,
  onSelect,
  context,
  provider,
}: LoadPendingDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Edit a pending transaction</DialogTitle>
          <DialogDescription>
            Load a pending transaction into the builder. Building the edited
            version will replace the original, and any collected signatures will
            need to be collected again.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto py-2 pr-2">
          {open &&
            pendingTransactions.map((transaction) => (
              <PendingRow
                key={transaction.id}
                transaction={transaction}
                context={context}
                provider={provider}
                requiredCount={requiredCount}
                onSelect={onSelect}
              />
            ))}
          {pendingTransactions.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No pending transactions.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PendingRow({
  transaction,
  context,
  provider,
  requiredCount,
  onSelect,
}: Pick<
  LoadPendingDialogProps,
  "context" | "provider" | "requiredCount" | "onSelect"
> & { transaction: Transaction }) {
  const { result, loading, retry } = usePendingEditor(
    transaction,
    context,
    provider,
  );
  return (
    <div>
      <button
        type="button"
        disabled={!result?.compatible}
        onClick={() => onSelect(transaction)}
        data-testid={`load-pending-tx-${transaction.id}`}
        className="flex w-full flex-col gap-1 rounded-md border border-border p-3 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">
            {transaction.description || "No description"}
          </span>
          <Badge variant="outline" className="shrink-0 text-xs">
            {transaction.signedAddresses.length}/{requiredCount} signed
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">
          {dateToFormatted(transaction.createdAt)}
        </span>
        {!result?.compatible && (
          <span className="text-xs text-muted-foreground">
            {loading
              ? "Checking original transaction and chain inputs…"
              : result?.reasons[0]}
          </span>
        )}
      </button>
      {!loading && !result?.compatible && (
        <button
          type="button"
          className="mt-1 text-xs underline"
          onClick={retry}
          aria-label={`Retry editing compatibility for ${transaction.description || "transaction"}`}
        >
          Retry check
        </button>
      )}
    </div>
  );
}
