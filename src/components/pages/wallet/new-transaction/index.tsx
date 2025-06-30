import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import {
  keepRelevant,
  NativeScript,
  Quantity,
  Unit,
  UTxO,
} from "@meshsdk/core";
import { useWallet } from "@meshsdk/react";

import useTransaction from "@/hooks/useTransaction";
import { toast, useToast } from "@/hooks/use-toast";
import useAppWallet from "@/hooks/useAppWallet";
import useMultisigWallet from "@/hooks/useMultisigWallet";

import { useUserStore } from "@/lib/zustand/user";
import { useSiteStore } from "@/lib/zustand/site";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { cn } from "@/lib/utils";
import sendDiscordMessage from "@/lib/discord/sendDiscordMessage";

import { api } from "@/utils/api";

import { Loader, PlusCircle, Send, X } from "lucide-react";
import { QuestionMarkCircledIcon } from "@radix-ui/react-icons";
import SectionTitle from "@/components/ui/section-title";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { getTxBuilder } from "@/utils/get-tx-builder";
import CardUI from "@/components/ui/card-content";
import { ToastAction } from "@/components/ui/toast";
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
import UTxOSelector from "./utxoSelector";
import RecipientRow from "./RecipientRow";
import RecipientCsv from "./RecipientCsv";

export default function PageNewTransaction() {
  const { connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const { appWallet } = useAppWallet();
  const { multisigWallet } = useMultisigWallet();
  const [addDescription, setAddDescription] = useState<boolean>(true);
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
  const [assets, setAssets] = useState<string[]>(["ADA"]);
  const walletAssetMetadata = useWalletsStore(
    (state) => state.walletAssetMetadata,
  );

  const { data: discordData } = api.user.getDiscordIds.useQuery({
    addresses: appWallet?.signersAddresses ?? [],
  });

  // Extract Discord IDs
  const discordIds = Object.values(discordData ?? {}).filter(Boolean);

  useEffect(() => {
    reset();
  }, []);

  function reset() {
    setAddDescription(true);
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
      // let totalAmount = 0;
      const outputs: { address: string; unit: string; amount: string }[] = [];
      const assetMap = new Map<Unit, Quantity>();

      for (let i = 0; i < recipientAddresses.length; i++) {
        const address = recipientAddresses[i];
        if (address && address.startsWith("addr") && address.length > 0) {
          const rawUnit = assets[i];
          // Default to 'lovelace' if rawUnit is undefined or if it's 'ADA'
          const unit = rawUnit
            ? rawUnit === "ADA"
              ? "lovelace"
              : rawUnit
            : "lovelace";
          const assetMetadata = walletAssetMetadata[unit];
          const multiplier =
            unit === "lovelace"
              ? 1000000
              : Math.pow(10, assetMetadata?.decimals ?? 0);
          const parsedAmount = parseFloat(amounts[i]!) || 0;
          const thisAmount = parsedAmount * multiplier;
          outputs.push({
            address: address,
            unit: unit,
            amount: thisAmount.toString(),
          });
          assetMap.set(
            unit,
            (Number(assetMap.get(unit) || 0) + thisAmount).toString(),
          );
        }
      }
      const utxos = manualUtxos;
      let selectedUtxos = utxos;

      if (!sendAllAssets) {
        selectedUtxos = keepRelevant(assetMap, utxos);
      }

      if (selectedUtxos.length === 0) {
        setError("Insufficient funds");
        return;
      }

      const txBuilder = getTxBuilder(network);
      const paymentScript = appWallet.scriptCbor
      if(!paymentScript) return

      for (const utxo of selectedUtxos) {
        txBuilder
          .txIn(
            utxo.input.txHash,
            utxo.input.outputIndex,
            utxo.output.amount,
            utxo.output.address,
          )
          .txInScript(paymentScript)
      }

//add this for staking txs
//add checks for registration will also be required for some gov stuff

//find way to refactor tx process.

      //if(!multisigWallet) return
      // const rewardAddress = multisigWallet?.getStakeAddress()
      // const stakingScript = multisigWallet?.getStakingScript()

      // if(!rewardAddress) return
      // if(!stakingScript) return
      //const poolIdHash = "62d90c8349f6a0675a6ea0f5b62aa68ccd8cb333b86044c69c5dadef"; //example from preprod

      //txBuilder.registerStakeCertificate(rewardAddress)
      //txBuilder.delegateStakeCertificate(rewardAddress, poolIdHash)
      // attach the multisig staking script for the stake certificate
      //txBuilder.certificateScript(stakingScript)

      // const paymentKeys = multisigWallet.getKeysByRole(0) ?? [];
      // console.log()
      // for (const key of paymentKeys) {
      //   txBuilder.requiredSignerHash(key.keyHash);
      // }

      // const stakingKeys = multisigWallet.getKeysByRole(2) ?? [];
      // for (const key of stakingKeys) {
      //   txBuilder.requiredSignerHash(key.keyHash);
      // }
      

      if (!sendAllAssets) {
        for (let i = 0; i < outputs.length; i++) {
          txBuilder.txOut(outputs[i]!.address, [
            {
              unit: outputs[i]!.unit,
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

      // send discord message
      await sendDiscordMessage(
        discordIds,
        `**NEW MULTISIG TRANSACTION:** A new Multisig transaction has been created for your wallet: ${appWallet.name}. Review it here: ${window.location.origin}/wallets/${appWallet.id}/transactions`,
      );

      router.push(`/wallets/${appWallet.id}/transactions`);
    } catch (e) {
      setLoading(false);
      console.error(e);
      toast({
        title: "Error",
        description: `${e}`,
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
        <RecipientCsv
          setRecipientAddresses={setRecipientAddresses}
          setAmounts={setAmounts}
          setAssets={setAssets}
          recipientAddresses={recipientAddresses}
          amounts={amounts}
          assets={assets}
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Address</TableHead>
              <TableHead className="w-[120px]">Amount</TableHead>
              <TableHead className="w-[120px]">Asset</TableHead>
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
                assets={assets}
                setAssets={setAssets}
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

      <CardUI title="Staking" cardClassName="w-full noBorder">
        Coming soon.
        {/* //Check if registered-> offer de-/registration
        //offer stake pool id input
        //offer withdrawl */}
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
