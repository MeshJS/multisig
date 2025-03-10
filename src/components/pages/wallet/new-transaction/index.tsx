import SectionTitle from "@/components/common/section-title";
import { Button } from "@/components/ui/button";
import useAppWallet from "@/hooks/useAppWallet";
import { keepRelevant, Quantity, Unit, UTxO } from "@meshsdk/core";
import { useWallet } from "@meshsdk/react";
import { Loader, Send } from "lucide-react";
import { useEffect, useState } from "react";
// import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { Textarea } from "@/components/ui/textarea";
// import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
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
import { getTxBuilder } from "@/components/common/cardano-objects/get-tx-builder";
import CardUI from "@/components/common/card-content";
import useTransaction from "@/hooks/useTransaction";
import { ToastAction } from "@/components/ui/toast";
import { toast, useToast } from "@/hooks/use-toast";
import RecipientSelector from "./recipientSelector";
import UTxOSelector from "./utxoSelector";
import { useRouter } from "next/router";

export default function PageNewTransaction() {
  const { connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const { appWallet } = useAppWallet();
  const [addDescription, setAddDescription] = useState<boolean>(false);
  const [description, setDescription] = useState<string>("");
  const [metadata, setMetadata] = useState<string>("");
  const [sendAllAssets, setSendAllAssets] = useState<boolean>(false);
  // const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // const { toast } = useToast();
  // const ctx = api.useUtils();
  const [recipientAddresses, setRecipientAddresses] = useState<string[]>([""]);
  const [manualUtxos, setManualUtxos] = useState<UTxO[]>([]);
  const [manualSelected, setManualSelected] = useState(false);
  const [amounts, setAmounts] = useState<string[]>([""]);
  const network = useSiteStore((state) => state.network);
  const { newTransaction } = useTransaction();
  const loading = useSiteStore((state) => state.loading);
  const setLoading = useSiteStore((state) => state.setLoading);
  const { toast } = useToast();
  const router = useRouter();

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
      const utxos = manualUtxos;
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

      if (sendAllAssets) {
        txBuilder.changeAddress(outputs[0]!.address);
      } else {
        txBuilder.changeAddress(appWallet.address);
      }

      await newTransaction({
        txBuilder,
        description: addDescription ? description : undefined,
        metadataValue:
          metadata.length > 0 ? { label: "674", value: metadata } : undefined,
      });
      reset();

      router.push(`/wallets/${appWallet.id}/transactions`);
    } catch (e) {
      setLoading(false);
      console.error(e);
      toast({
        title: "Error",
        description: `${JSON.stringify(e)}`,
        duration: 10000,
        action: (
          <ToastAction
            altText="Try again"
            onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(e));
              toast({
                title: "Error Copied",
                description: `Error has been copied to your clipboard.`,
                duration: 5000,
              });
            }}
          >
            Copy Error
          </ToastAction>
        ),
        variant: "destructive",
      });
    }
  }

  function addNewRecipient() {
    setRecipientAddresses([...recipientAddresses, ""]);
    setAmounts([...amounts, ""]);
  }

  return (
    <main className="pointer-events-auto flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <SectionTitle>New Transaction</SectionTitle>

      <CardUI title="Recipients" cardClassName="w-full">
        <RecipientSelector
          recipientAddresses={recipientAddresses}
          setRecipientAddresses={setRecipientAddresses}
          amounts={amounts}
          setAmounts={setAmounts}
          disableAdaAmountInput={sendAllAssets}
        />
      </CardUI>

      <CardUI title="UTxOs" cardClassName="w-full noBorder">
        {appWallet && (
          <UTxOSelector
            appWallet={appWallet}
            network={network}
            onSelectionChange={(utxos, manual) => {
              setManualUtxos(utxos);
              setManualSelected(manual);
            }}
          />
        )}
      </CardUI>

      <CardUI
        title="Description"
        description="To provide more information to other signers."
        cardClassName="w-full"
      >
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>
                <Textarea
                  className="min-h-16"
                  value={description}
                  onChange={(e) => {
                    if (e.target.value.length <= 128)
                      setDescription(e.target.value);
                  }}
                  placeholder="@user contributed PR #123"
                />
                {description.length >= 128 && (
                  <p className="text-red-500">
                    Description should be less than 128 characters
                  </p>
                )}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardUI>

      <CardUI
        title="On-chain Metadata"
        description="Metadata attaches additional information to a transaction viewable on the blockchain."
        cardClassName="w-full"
      >
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>
                <Textarea
                  className="min-h-16"
                  value={metadata}
                  onChange={(e) => {
                    if (e.target.value.length <= 64)
                      setMetadata(e.target.value);
                  }}
                  placeholder={`PR #123`}
                />
                {metadata.length >= 64 && (
                  <p className="text-red-500">
                    Metadata should be less than 64 characters
                  </p>
                )}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardUI>

      <CardUI
        title="Transaction options"
        description="Additional options for the transaction."
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