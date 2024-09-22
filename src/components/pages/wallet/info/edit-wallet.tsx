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
import { useEffect, useState } from "react";
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
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { QuestionMarkCircledIcon } from "@radix-ui/react-icons";
import { useSiteStore } from "@/lib/zustand/site";
import { Checkbox } from "@/components/ui/checkbox";
import { Wallet } from "@/types/wallet";

export function EditWallet({ appWallet }: { appWallet: Wallet }) {
  const { wallet, connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const [addDescription, setAddDescription] = useState<boolean>(false);
  const [description, setDescription] = useState<string>("");
  const [addMetadata, setAddMetadata] = useState<boolean>(false);
  const [metadata, setMetadata] = useState<string>("");
  const [showAddAllAssets, setShowAddAllAssets] = useState<boolean>(false);
  const [sendAllAssets, setSendAllAssets] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const ctx = api.useUtils();
  const [recipientAddresses, setRecipientAddresses] = useState<string[]>([""]);
  const [amounts, setAmounts] = useState<string[]>([""]);
  const network = useSiteStore((state) => state.network);

  useEffect(() => {
    setAddDescription(false);
    setDescription("");
    setAddMetadata(false);
    setMetadata("");
    setShowAddAllAssets(false);
    setSendAllAssets(false);
  }, [open]);

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
      const outputs: { address: string; amount: string }[] = [];
      for (let i = 0; i < recipientAddresses.length; i++) {
        const address = recipientAddresses[i];
        if (address && address.startsWith("addr") && address.length > 0) {
          const thisAmount = parseFloat(amounts[i] as string) * 1000000;
          totalAmount += thisAmount;
          outputs.push({
            address: recipientAddresses[i]!,
            amount: thisAmount.toString(),
          });
        }
      }

      const blockchainProvider = getProvider(network);
      const utxos = await blockchainProvider.fetchAddressUTxOs(
        appWallet.address,
      );

      let selectedUtxos = utxos;

      if (!sendAllAssets) {
        const assetMap = new Map<Unit, Quantity>();
        assetMap.set("lovelace", totalAmount.toString());
        selectedUtxos = keepRelevant(assetMap, utxos);
      }

      if (selectedUtxos.length === 0) {
        setError("Insufficient funds");
        return;
      }

      const txBuilder = getTxBuilder(network);

      for (const utxo of selectedUtxos) {
        txBuilder.txIn(
          utxo.input.txHash,
          utxo.input.outputIndex,
          utxo.output.amount,
          utxo.output.address,
        );
        txBuilder.txInScript(appWallet.scriptCbor);
      }

      if (!sendAllAssets) {
        for (let i = 0; i < outputs.length; i++) {
          txBuilder.txOut(outputs[i]!.address, [
            {
              unit: "lovelace",
              quantity: outputs[i]!.amount,
            },
          ]);
        }
      }

      if (addMetadata && metadata.length > 0) {
        txBuilder.metadataValue("674", {
          msg: metadata.split("\n"),
        });
      }

      if (sendAllAssets) {
        txBuilder.changeAddress(outputs[0]!.address);
      } else {
        txBuilder.changeAddress(appWallet.address);
      }

      const unsignedTx = await txBuilder.complete();
      const signedTx = await wallet.signTx(unsignedTx, true);

      const signedAddresses = [];
      signedAddresses.push(userAddress);

      let txHash = undefined;
      let state = 0;
      if (appWallet.numRequiredSigners == signedAddresses.length) {
        state = 1;
        txHash = await wallet.submitTx(signedTx);
      }

      createTransaction({
        walletId: appWallet.id,
        txJson: JSON.stringify(txBuilder.meshTxBuilderBody),
        txCbor: signedTx,
        signedAddresses: [userAddress],
        state: state,
        description: addDescription ? description : undefined,
        txHash: txHash,
      });
    } catch (e) {
      setLoading(false);
      setError("Invalid transaction");
      console.error(e);
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
              <></>
            ))}
            <TableRow>
              <TableCell colSpan={3}>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1"
                  onClick={() => addNewRecipient()}
                  disabled={sendAllAssets}
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
              <TableHead
                onClick={() => setAddDescription(!addDescription)}
                className="flex cursor-pointer items-center gap-2"
              >
                {!addDescription && `Add `}Description (optional){" "}
                <HoverCard>
                  <HoverCardTrigger>
                    <QuestionMarkCircledIcon className="h-4 w-4" />
                  </HoverCardTrigger>
                  <HoverCardContent>
                    Description is useful to provide more information to other
                    signers.
                  </HoverCardContent>
                </HoverCard>
              </TableHead>
            </TableRow>
          </TableHeader>
          {addDescription && (
            <TableBody>
              <TableRow>
                <TableCell>
                  <Textarea
                    className="min-h-16"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional description for other signers"
                  />
                </TableCell>
              </TableRow>
            </TableBody>
          )}
        </Table>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                onClick={() => setAddMetadata(!addMetadata)}
                className="flex cursor-pointer items-center gap-2"
              >
                {!addMetadata && `Add `}On-chain Metadata (optional){" "}
                <HoverCard>
                  <HoverCardTrigger>
                    <QuestionMarkCircledIcon className="h-4 w-4" />
                  </HoverCardTrigger>
                  <HoverCardContent>
                    Metadata attaches additional information to a transaction
                    viewable on the blockchain.
                  </HoverCardContent>
                </HoverCard>
              </TableHead>
            </TableRow>
          </TableHeader>
          {addMetadata && (
            <TableBody>
              <TableRow>
                <TableCell>
                  <Textarea
                    className="min-h-16"
                    value={metadata}
                    onChange={(e) => setMetadata(e.target.value)}
                    placeholder="Optional description for other signers"
                  />
                </TableCell>
              </TableRow>
            </TableBody>
          )}
        </Table>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                onClick={() => setShowAddAllAssets(!showAddAllAssets)}
                className="flex cursor-pointer items-center gap-2"
              >
                Transaction options
                <HoverCard>
                  <HoverCardTrigger>
                    <QuestionMarkCircledIcon className="h-4 w-4" />
                  </HoverCardTrigger>
                  <HoverCardContent>
                    Additional options for the transaction.
                  </HoverCardContent>
                </HoverCard>
              </TableHead>
            </TableRow>
          </TableHeader>
          {showAddAllAssets && (
            <TableBody>
              <TableRow>
                <TableCell>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="sendAllAssetCheck"
                      checked={sendAllAssets}
                      onCheckedChange={() => setSendAllAssets(!sendAllAssets)}
                    />
                    <label
                      htmlFor="sendAllAssetCheck"
                      className="flex items-center gap-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Send all assets
                      <HoverCard>
                        <HoverCardTrigger>
                          <QuestionMarkCircledIcon className="h-4 w-4" />
                        </HoverCardTrigger>
                        <HoverCardContent>
                          Enable this will send all assets to the first
                          recipient's address.
                        </HoverCardContent>
                      </HoverCard>
                    </label>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          )}
        </Table>

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