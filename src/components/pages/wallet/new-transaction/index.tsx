import SectionTitle from "@/components/common/section-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import useAppWallet from "@/hooks/useAppWallet";
import {
  keepRelevant,
  Quantity,
  resolveScriptHash,
  serializeRewardAddress,
  Unit,
  UTxO,
} from "@meshsdk/core";
import { useWallet } from "@meshsdk/react";
import { Loader, PlusCircle, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
// import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { Textarea } from "@/components/ui/textarea";
// import { useToast } from "@/hooks/use-toast";
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
import { getTxBuilder } from "@/components/common/cardano-objects/get-tx-builder";
import CardUI from "@/components/common/card-content";
import useTransaction from "@/hooks/useTransaction";
import { ToastAction } from "@/components/ui/toast";
import { toast, useToast } from "@/hooks/use-toast";
import UTxOSelector from "./utxoSelector";
import { useRouter } from "next/router";
import sendDiscordMessage from "@/lib/discord/sendDiscordMessage";
import { api } from "@/utils/api";
import { resolveAdaHandle } from "@/components/common/cardano-objects/resolve-adahandle";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { cn } from "@/lib/utils";

export default function PageNewTransaction() {
  const { connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const { appWallet } = useAppWallet();
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
        // const assetMap = new Map<Unit, Quantity>();
        // assetMap.set("lovelace", totalAmount.toString());
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

      // const rewardAddress = serializeRewardAddress(
      //   resolveScriptHash(appWallet.scriptCbor),
      //   true,
      //   0,
      // );
      // console.log(rewardAddress);
      // const poolIdHash =
      //   "62d90c8349f6a0675a6ea0f5b62aa68ccd8cb333b86044c69c5dadef"; //example from preprod
      // console.log(txBuilder)
      // txBuilder.registerStakeCertificate(rewardAddress)
      // //txBuilder.certificateRedeemerValue()
      // console.log(txBuilder)
      // //txBuilder.certificateScript(appWallet.scriptCbor)
      // console.log(txBuilder)
      // //txBuilder.delegateStakeCertificate(rewardAddress, poolIdHash)
      // console.log(txBuilder)

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

function RecipientRow({
  index,
  recipientAddresses,
  setRecipientAddresses,
  amounts,
  setAmounts,
  assets,
  setAssets,
  disableAdaAmountInput,
}: {
  index: number;
  recipientAddresses: string[];
  setRecipientAddresses: (value: string[]) => void;
  amounts: string[];
  setAmounts: (value: string[]) => void;
  assets: string[];
  setAssets: (value: string[]) => void;
  disableAdaAmountInput: boolean;
}) {
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);
  const [adaHandle, setAdaHandle] = useState<string>("");

  const walletAssets = useWalletsStore((state) => state.walletAssets);
  const walletAssetMetadata = useWalletsStore(
    (state) => state.walletAssetMetadata,
  );

  const handleAddressChange = async (value: string) => {
    const newAddresses = [...recipientAddresses];
    newAddresses[index] = value;
    setRecipientAddresses(newAddresses);

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (value.startsWith("$")) {
      const newTimeoutId = setTimeout(() => {
        void resolveAdaHandle(
          setAdaHandle,
          setRecipientAddresses,
          recipientAddresses,
          index,
          value,
        );
      }, 1000);
      setTimeoutId(newTimeoutId);
    } else {
      setAdaHandle("");
    }
  };

  const appWalletAssets = useMemo(() => {
    return walletAssets.map((asset) => {
      return {
        unit: asset.unit,
        assetName: walletAssetMetadata[asset.unit]?.assetName,
        decimals: walletAssetMetadata[asset.unit]?.decimals ?? 0,
        amount: asset.quantity,
      };
    });
  }, [walletAssets, walletAssetMetadata]);

  const assetOptions = useMemo(() => {
    return (
      <>
        {appWalletAssets.map((appWalletAssets) => {
          return (
            <option key={appWalletAssets.unit} value={appWalletAssets.unit}>
              {appWalletAssets.unit === "lovelace"
                ? "ADA"
                : appWalletAssets.assetName}
            </option>
          );
        })}
      </>
    );
  }, [appWalletAssets]);

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-1">
          <Input
            type="string"
            placeholder="addr1... or $handle"
            value={recipientAddresses[index]}
            onChange={(e) => {
              void handleAddressChange(e.target.value);
            }}
          />
          {adaHandle && <TableCell>{adaHandle}</TableCell>}
        </div>
      </TableCell>
      <TableCell>
        <div
          className="flex flex-col"
          style={{ minHeight: adaHandle ? "76px" : "auto" }}
        >
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
        </div>
      </TableCell>
      <TableCell className="w-[240px]">
        <select
          value={assets[index]}
          onChange={(e) => {
            const newAssets = [...assets];
            newAssets[index] = e.target.value;
            setAssets(newAssets);
          }}
          disabled={disableAdaAmountInput}
          className={cn(
            "flex h-9 w-full rounded-md border border-zinc-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:placeholder:text-zinc-400 dark:focus-visible:ring-zinc-300",
          )}
        >
          {assetOptions}
        </select>
      </TableCell>
      <TableCell>
        <div
          className="flex flex-col"
          style={{ minHeight: adaHandle ? "76px" : "auto" }}
        >
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
        </div>
      </TableCell>
    </TableRow>
  );
}
