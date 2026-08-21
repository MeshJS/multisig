import { useMemo } from "react";
import type { Transaction } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isDraftCompatible } from "@/lib/tx-draft/from-tx-json";
import { dateToFormatted } from "@/utils/strings";

interface LoadPendingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingTransactions: Transaction[];
  requiredCount: number;
  onSelect: (transaction: Transaction) => void;
}

/**
 * Picker for editing an existing pending transaction in the builder. Only
 * simple sends can round-trip into a draft — incompatible transactions are
 * shown disabled with the reason.
 */
export default function LoadPendingDialog({
  open,
  onOpenChange,
  pendingTransactions,
  requiredCount,
  onSelect,
}: LoadPendingDialogProps) {
  const rows = useMemo(
    () =>
      pendingTransactions.map((transaction) => {
        let compat;
        try {
          compat = isDraftCompatible(JSON.parse(transaction.txJson));
        } catch {
          compat = { compatible: false, reasons: ["Unreadable transaction"] };
        }
        return { transaction, compat };
      }),
    [pendingTransactions],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Edit a pending transaction</DialogTitle>
          <DialogDescription>
            Load a pending transaction into the builder. Building the edited
            version will replace the original, and any collected signatures
            will need to be collected again.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto py-2 pr-2">
          {rows.map(({ transaction, compat }) => (
            <button
              key={transaction.id}
              type="button"
              disabled={!compat.compatible}
              onClick={() => onSelect(transaction)}
              data-testid={`load-pending-tx-${transaction.id}`}
              className="flex flex-col gap-1 rounded-md border border-border p-3 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
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
              {!compat.compatible && (
                <span className="text-xs text-muted-foreground">
                  {compat.reasons[0]}
                </span>
              )}
            </button>
          ))}
          {rows.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No pending transactions.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
