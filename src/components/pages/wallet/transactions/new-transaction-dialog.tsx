import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import PageNewTransaction from "@/components/pages/wallet/new-transaction";
import { api } from "@/utils/api";

interface NewTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walletId: string;
}

export default function NewTransactionDialog({
  open,
  onOpenChange,
  walletId,
}: NewTransactionDialogProps) {
  const ctx = api.useUtils();

  const handleSuccess = () => {
    onOpenChange(false);
    // Invalidate queries to refresh transaction list
    void ctx.transaction.getPendingTransactions.invalidate({ walletId });
    void ctx.transaction.getAllTransactions.invalidate({ walletId });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[calc(100dvh-3.5rem)] max-h-[calc(100dvh-3.5rem)] w-[100vw] max-w-[100vw] top-[3.5rem] translate-x-[-50%] translate-y-0 rounded-none border-0 border-t p-0 sm:top-[50%] sm:translate-y-[-50%] sm:h-[95vh] sm:max-h-[95vh] sm:w-[95vw] sm:max-w-[95vw] sm:rounded-lg sm:border sm:p-6 md:max-w-[90vw] lg:max-w-[85vw] lg:top-[50%]">
        <div className="flex h-full flex-col overflow-hidden">
          {/* Sticky Header */}
          <DialogHeader className="flex-shrink-0 border-b px-4 py-3 sm:px-0 sm:py-0 sm:border-b-0">
            <DialogTitle className="text-lg sm:text-xl">New Transaction</DialogTitle>
            <DialogDescription className="hidden text-sm sm:block">
              Create a new multisig transaction by specifying recipients, amounts,
              and transaction details.
            </DialogDescription>
          </DialogHeader>
          
          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-0 sm:py-4">
            <PageNewTransaction onSuccess={handleSuccess} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

