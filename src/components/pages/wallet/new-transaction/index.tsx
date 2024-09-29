import SectionTitle from "@/components/common/section-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import useAppWallet from "@/hooks/useAppWallet";
import { keepRelevant, Quantity, Unit } from "@meshsdk/core";
import { useWallet } from "@meshsdk/react";
import { Loader, PlusCircle, Send, X } from "lucide-react";
import { use, useEffect, useState } from "react";
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
import { getProvider } from "@/components/common/cardano-objects/get-provider";
import { getTxBuilder } from "@/components/common/cardano-objects/get-tx-builder";
import CardUI from "@/components/common/card-content";

// todo make this a new page instead of dialog
export default function PageNewTransaction() {
  const { wallet, connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const { appWallet } = useAppWallet();
  const [addDescription, setAddDescription] = useState<boolean>(false);
  const [description, setDescription] = useState<string>("");
  const [metadata, setMetadata] = useState<string>("");
  const [sendAllAssets, setSendAllAssets] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const { toast } = useToast();
  const ctx = api.useUtils();
  const [recipientAddresses, setRecipientAddresses] = useState<string[]>([""]);
  const [amounts, setAmounts] = useState<string[]>([""]);
  const network = useSiteStore((state) => state.network);

  useEffect(() => {
    reset();
  }, []);

  function reset() {
    setAddDescription(false);
    setDescription("");
    setMetadata("");
    setSendAllAssets(false);
    setLoading(false);
  }

  const { mutate: createTransaction } =
    api.transaction.createTransaction.useMutation({
      onSuccess: async () => {
        toast({
          title: "Transaction Created",
          description: "Your transaction has been created",
          duration: 5000,
        });
        void ctx.transaction.getPendingTransactions.invalidate();
        reset();
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
        txBuilder
          .txIn(
            utxo.input.txHash,
            utxo.input.outputIndex,
            utxo.output.amount,
            utxo.output.address,
          )
          .txInScript(appWallet.scriptCbor);
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

      if (metadata.length > 0) {
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
      let submitTx = false;

      if (appWallet.type == "any") {
        submitTx = true;
      } else if (
        appWallet.type == "atLeast" &&
        appWallet.numRequiredSigners == signedAddresses.length
      ) {
        submitTx = true;
      } else if (
        appWallet.type == "all" &&
        appWallet.signersAddresses.length == signedAddresses.length
      ) {
        submitTx = true;
      }

      if (submitTx) {
        txHash = await wallet.submitTx(signedTx);
      }

      createTransaction({
        walletId: appWallet.id,
        txJson: JSON.stringify(txBuilder.meshTxBuilderBody),
        txCbor: signedTx,
        signedAddresses: [userAddress],
        state: submitTx ? 1 : 0,
        description: addDescription ? description : undefined,
        txHash: txHash,
      });
    } catch (e) {
      setLoading(false);
      setError("Error creating transaction");
      console.error(e);
    }
  }

  function addNewRecipient() {
    setRecipientAddresses([...recipientAddresses, ""]);
    setAmounts([...amounts, ""]);
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <SectionTitle>New Transaction</SectionTitle>

      <CardUI title="Recipients" icon={`₳`} cardClassName="w-full">
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
                disableAdaAmountInput={sendAllAssets}
              />
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
      </CardUI>

      <CardUI
        title="Description"
        description="Description is useful to provide more information to other signers."
        icon={`₳`}
        cardClassName="w-full"
      >
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>
                <Textarea
                  className="min-h-16"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="For @user contributed PR #123"
                />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardUI>

      <CardUI
        title="Metadata"
        description="Metadata attaches additional information to a transaction viewable on the blockchain."
        icon={`₳`}
        cardClassName="w-full"
      >
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>
                <Textarea
                  className="min-h-16"
                  value={metadata}
                  onChange={(e) => setMetadata(e.target.value)}
                  placeholder={`PR #123`}
                />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardUI>

      <CardUI
        title="Transaction options"
        description="Additional options for the transaction."
        icon={`₳`}
        cardClassName="w-full"
      >
        <Table>
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
                    Send all assets to one recipient
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
        </Table>
      </CardUI>

      <div className="flex h-full items-center justify-center gap-4">
        <Button onClick={() => createNewTransaction()} disabled={loading}>
          {loading ? (
            <Loader className="mr-2 h-4 w-4" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Create and Sign Transaction
        </Button>
        {error && <div className="text-sm text-red-500">{error}</div>}
      </div>
    </main>
  );
}

function RecipientRow({
  index,
  recipientAddresses,
  setRecipientAddresses,
  amounts,
  setAmounts,
  disableAdaAmountInput,
}: {
  index: number;
  recipientAddresses: string[];
  setRecipientAddresses: (value: string[]) => void;
  amounts: string[];
  setAmounts: (value: string[]) => void;
  disableAdaAmountInput: boolean;
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
          disabled={disableAdaAmountInput}
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
