import { getProvider, getTxBuilder } from "@/components/common/cardano-objects";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import useAppWallet from "@/hooks/useAppWallet";
import { keepRelevant, Quantity, Unit } from "@meshsdk/core";
import { useWallet } from "@meshsdk/react";
import { Loader, Send } from "lucide-react";
import { useState } from "react";
import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

export function NewTransaction({ walletId }: { walletId: string }) {
  const { wallet, connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const { appWallet } = useAppWallet({ walletId });
  const [recipientAddress, setRecipientAddress] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const ctx = api.useUtils();

  const { mutate: createTransaction } =
    api.transaction.createTransaction.useMutation({
      onSuccess: async () => {
        setOpen(false);
        setLoading(false);
        toast({
          title: "Transaction Created",
          description: "Your transaction has been created",
          duration: 5000,
        });
        void ctx.transaction.getPendingTransactions.invalidate();
        setRecipientAddress("");
        setAmount("");
        setDescription("");
      },
      onError: (e) => {
        console.error(e);
        setLoading(false);
      },
    });

  async function createNewTransaction() {
    if (!connected) throw new Error("Wallet not connected");
    if (!appWallet) throw new Error("Wallet not found");
    if (!userAddress) throw new Error("User address not found");

    setLoading(true);
    setError(undefined);

    const _amount = (parseFloat(amount) * 1000000).toString();

    const blockchainProvider = getProvider();
    const utxos = await blockchainProvider.fetchAddressUTxOs(appWallet.address);

    const assetMap = new Map<Unit, Quantity>();
    assetMap.set("lovelace", _amount);

    const selectedUtxos = keepRelevant(assetMap, utxos);

    if (selectedUtxos.length === 0) {
      setError("Insufficient funds");
      return;
    }

    const txBuilder = getTxBuilder();

    for (const utxo of selectedUtxos) {
      txBuilder.txIn(
        utxo.input.txHash,
        utxo.input.outputIndex,
        utxo.output.amount,
        utxo.output.address,
      );
    }

    txBuilder
      .txInScript(appWallet.scriptCbor)
      .txOut(recipientAddress, [{ unit: "lovelace", quantity: _amount }])
      .changeAddress(appWallet.address)
      .selectUtxosFrom(selectedUtxos);

    const unsignedTx = await txBuilder.complete();
    const signedTx = await wallet.signTx(unsignedTx, true);

    createTransaction({
      walletId: appWallet.id,
      txJson: JSON.stringify(txBuilder.meshTxBuilderBody),
      txCbor: signedTx,
      signedAddresses: [userAddress],
      state: 0,
      description: description,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">New Transaction</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>New Transaction</DialogTitle>
          <DialogDescription>Send ADA to another address</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="address" className="text-right">
              Address
            </Label>
            <Input
              id="address"
              className="col-span-3"
              placeholder="addr1..."
              value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="amount" className="text-right">
              Amount ADA
            </Label>
            <Input
              id="amount"
              type="number"
              className="col-span-3"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="amount in ADA"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="desc" className="text-right">
              Description
            </Label>
            <Textarea
              id="desc"
              className="col-span-3 min-h-[9.5rem]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description for this transaction"
            />
          </div>
        </div>
        <DialogFooter>
          <div className="flex h-full items-center justify-center gap-4">
            {error && <div className="text-sm text-red-500">{error}</div>}
            <Button onClick={() => createNewTransaction()} disabled={loading}>
              {loading ? (
                <Loader className="mr-2 h-4 w-4" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Send
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
