import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/utils/api";
import { Loader } from "lucide-react";

interface ImportTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walletId: string;
}

export default function ImportTransactionDialog({
  open,
  onOpenChange,
  walletId,
}: ImportTransactionDialogProps) {
  const [cbor, setCbor] = useState("");
  const [description, setDescription] = useState("");
  const { toast } = useToast();
  const ctx = api.useUtils();

  const { mutate: importTransaction, isPending } =
    api.transaction.importTransaction.useMutation({
      onSuccess: () => {
        toast({
          title: "Transaction Imported",
          description: "Transaction has been imported successfully",
        });
        setCbor("");
        setDescription("");
        onOpenChange(false);
        void ctx.transaction.getPendingTransactions.invalidate({ walletId });
        void ctx.transaction.getAllTransactions.invalidate({ walletId });
      },
      onError: (error) => {
        toast({
          title: "Import Failed",
          description: error.message || "Failed to import transaction",
          variant: "destructive",
        });
      },
    });

  const handleImport = () => {
    if (!cbor.trim()) {
      toast({
        title: "Invalid Input",
        description: "Please enter a valid CBOR hex string",
        variant: "destructive",
      });
      return;
    }

    importTransaction({
      walletId,
      txCbor: cbor.trim(),
      description: description.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Import Transaction</DialogTitle>
          <DialogDescription>
            Paste the CBOR hex string of a signed transaction. The transaction
            will be verified to ensure it's signed by one of the wallet signers
            before being added as a pending transaction.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Description (Optional)</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description for this transaction..."
              disabled={isPending}
              maxLength={255}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Transaction CBOR (Hex)</label>
            <Textarea
              value={cbor}
              onChange={(e) => setCbor(e.target.value)}
              placeholder="Paste CBOR hex string here..."
              className="min-h-[200px] font-mono text-xs"
              disabled={isPending}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={isPending || !cbor.trim()}>
            {isPending ? (
              <>
                <Loader className="mr-2 h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              "Import Transaction"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

