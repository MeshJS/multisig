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
import useAppWallet from "@/hooks/useAppWallet";
import { keepRelevant, Quantity, Unit } from "@meshsdk/core";
import { useWallet } from "@meshsdk/react";
import { Loader, PlusCircle, Send, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function NewTransaction({ walletId }: { walletId: string }) {
  const { wallet, connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const { appWallet } = useAppWallet({ walletId });
  const [description, setDescription] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const ctx = api.useUtils();
  const [recipientAddresses, setRecipientAddresses] = useState<string[]>([""]);
  const [amounts, setAmounts] = useState<string[]>([""]);

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
        setRecipientAddresses([]);
        setAmounts([]);
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

    try {
      let totalAmount = 0;
      const outputs = [];
      for (let i = 0; i < recipientAddresses.length; i++) {
        const thisAmount = parseFloat(amounts[i] as string) * 1000000;
        totalAmount += thisAmount;
        outputs.push({
          address: recipientAddresses[i],
          amount: thisAmount.toString(),
        });
      }

      const blockchainProvider = getProvider();
      const utxos = await blockchainProvider.fetchAddressUTxOs(
        appWallet.address,
      );

      const assetMap = new Map<Unit, Quantity>();
      assetMap.set("lovelace", totalAmount.toString());

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

      txBuilder.txInScript(appWallet.scriptCbor);

      for (let i = 0; i < outputs.length; i++) {
        txBuilder.txOut(outputs[i]!.address!, [
          {
            unit: "lovelace",
            quantity: outputs[i]!.amount,
          },
        ]);
      }

      txBuilder.changeAddress(appWallet.address).selectUtxosFrom(selectedUtxos);

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
    } catch (e) {
      setLoading(false);
      setError("Invalid transaction");
    }
  }

  function addNewRecipient() {
    setRecipientAddresses([...recipientAddresses, ""]);
    setAmounts([...amounts, ""]);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">New Transaction</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>New Transaction</DialogTitle>
          <DialogDescription>Send ADA to multiple recipients</DialogDescription>
        </DialogHeader>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Address</TableHead>
              <TableHead className="w-[120px]">Amount in ADA</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recipientAddresses.map((_, index) => (
              <RecipientRow
                key={index}
                index={index}
                recipientAddresses={recipientAddresses}
                setRecipientAddresses={setRecipientAddresses}
                amounts={amounts}
                setAmounts={setAmounts}
              />
            ))}
            <TableRow>
              <TableCell colSpan={3}>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1"
                  onClick={() => addNewRecipient()}
                >
                  <PlusCircle className="h-3.5 w-3.5" />
                  Add Recipient
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell colSpan={3}>
                <Textarea
                  id="desc"
                  className="col-span-3 min-h-[9.5rem]"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description for this transaction"
                />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {/* <div className="grid grid-cols-4 items-center gap-4">
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
        </div> */}

        <DialogFooter>
          <div className="flex h-full items-center justify-center gap-4">
            {error && <div className="text-sm text-red-500">{error}</div>}
            <Button onClick={() => createNewTransaction()} disabled={loading}>
              {loading ? (
                <Loader className="mr-2 h-4 w-4" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Create and Sign Transaction
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecipientRow({
  index,
  recipientAddresses,
  setRecipientAddresses,
  amounts,
  setAmounts,
}: {
  index: number;
  recipientAddresses: string[];
  setRecipientAddresses: (value: string[]) => void;
  amounts: string[];
  setAmounts: (value: string[]) => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <Input
          type="string"
          placeholder="addr1..."
          value={recipientAddresses[index]}
          onChange={(e) => {
            const newAddresses = [...recipientAddresses];
            newAddresses[index] = e.target.value;
            setRecipientAddresses(newAddresses);
          }}
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          value={amounts[index]}
          onChange={(e) => {
            const newAmounts = [...amounts];
            newAmounts[index] = e.target.value;
            setAmounts(newAmounts);
          }}
          placeholder=""
        />
      </TableCell>
      <TableCell>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => {
            const newAddresses = [...recipientAddresses];
            newAddresses.splice(index, 1);
            setRecipientAddresses(newAddresses);
            const newAmounts = [...amounts];
            newAmounts.splice(index, 1);
            setAmounts(newAmounts);
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
