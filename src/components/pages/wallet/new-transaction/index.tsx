import { useEffect, useState, useMemo, useCallback } from "react";
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

import { Loader, PlusCircle, Send, X, ChevronDown } from "lucide-react";
import { QuestionMarkCircledIcon } from "@radix-ui/react-icons";
import SectionTitle from "@/components/ui/section-title";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import UTxOSelector from "./utxoSelector";
import RecipientRow from "./RecipientRow";
import RecipientRowMobile from "./RecipientRowMobile";
import RecipientCsv from "./RecipientCsv";
import { truncateTokenSymbol } from "@/utils/strings";
import { UserPlus } from "lucide-react";

export default function PageNewTransaction({ onSuccess }: { onSuccess?: () => void } = {}) {
  const { connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const router = useRouter();
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
  const [assets, setAssets] = useState<string[]>(["lovelace"]);
  const walletAssetMetadata = useWalletsStore(
    (state) => state.walletAssetMetadata,
  );
  const [previewTxBody, setPreviewTxBody] = useState<{
    inputs: Array<{ txHash: string; outputIndex: number }>;
    outputs: Array<{
      address: string;
      amount: Array<{ unit: string; quantity: string }>;
    }>;
    changeAddress?: string;
  } | null>(null);

  const { data: discordData } = api.user.getDiscordIds.useQuery({
    addresses: appWallet?.signersAddresses ?? [],
  });

  // Extract Discord IDs
  const discordIds = Object.values(discordData ?? {}).filter(Boolean);

  // Fetch contacts
  const { data: contacts } = api.contact.getAll.useQuery(
    { walletId: appWallet?.id ?? "" },
    {
      enabled: !!appWallet?.id,
    },
  );

  // Create address lookup maps
  const contactMap = useMemo<
    Map<string, { name: string; description?: string | null }>
  >(() => {
    if (!contacts) return new Map();
    const map = new Map<
      string,
      { name: string; description?: string | null }
    >();
    contacts.forEach(
      (contact: {
        address: string;
        name: string;
        description?: string | null;
      }) => {
        map.set(contact.address, {
          name: contact.name,
          description: contact.description ?? undefined,
        });
      },
    );
    return map;
  }, [contacts]);

  // Function to get address label
  const getAddressLabel = useCallback(
    (
      address: string,
    ): { label: string; type: "self" | "signer" | "contact" | "unknown" } => {
      if (!appWallet) return { label: "", type: "unknown" };

      // Check if it's the multisig wallet address
      if (address === appWallet.address) {
        return { label: "Self (Multisig)", type: "self" };
      }

      // Check if it's a signer
      const signerIndex = appWallet.signersAddresses?.findIndex(
        (addr) => addr === address,
      );
      if (signerIndex !== undefined && signerIndex >= 0) {
        const signerDescription =
          appWallet.signersDescriptions?.[signerIndex] ||
          `Signer ${signerIndex + 1}`;
        return { label: signerDescription, type: "signer" };
      }

      // Check if it's a contact
      const contact = contactMap.get(address);
      if (contact) {
        return { label: contact.name, type: "contact" };
      }

      return { label: "", type: "unknown" };
    },
    [appWallet, contactMap],
  );

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Calculate final UTxOs that will be used in transaction (after keepRelevant filtering)
  const finalSelectedUtxos = useMemo(() => {
    if (manualUtxos.length === 0) return [];

    if (sendAllAssets) {
      return manualUtxos;
    }

    // Calculate required assets
    const assetMap = new Map<Unit, Quantity>();
    for (let i = 0; i < recipientAddresses.length; i++) {
      const address = recipientAddresses[i];
      if (address && address.startsWith("addr") && address.length > 0) {
        const rawUnit = assets[i];
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
        assetMap.set(
          unit,
          (Number(assetMap.get(unit) || 0) + thisAmount).toString(),
        );
        if (unit !== "lovelace") {
          assetMap.set(
            "lovelace",
            (Number(assetMap.get("lovelace") || 0) + 1160000).toString(),
          );
        }
      }
    }

    if (assetMap.size === 0) return manualUtxos;

    return keepRelevant(assetMap, manualUtxos);
  }, [
    manualUtxos,
    sendAllAssets,
    recipientAddresses,
    amounts,
    assets,
    walletAssetMetadata,
  ]);

  // Preview transaction outputs as user prepares the transaction
  useEffect(() => {
    if (!appWallet || !userAddress) {
      setPreviewTxBody(null);
      return;
    }

    try {
      const outputs: { address: string; unit: string; amount: string }[] = [];
      const assetMap = new Map<Unit, Quantity>();

      // Build outputs from recipients
      for (let i = 0; i < recipientAddresses.length; i++) {
        const address = recipientAddresses[i];
        if (address && address.startsWith("addr") && address.length > 0) {
          const rawUnit = assets[i];
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
          if (unit !== "lovelace") {
            assetMap.set(
              "lovelace",
              (Number(assetMap.get("lovelace") || 0) + 1160000).toString(),
            );
          }
        }
      }

      // Build inputs from final selected UTxOs
      const inputs = finalSelectedUtxos.map((utxo) => ({
        txHash: utxo.input.txHash,
        outputIndex: utxo.input.outputIndex,
      }));

      // Build output array for preview
      const previewOutputs: Array<{
        address: string;
        amount: Array<{ unit: string; quantity: string }>;
      }> = [];

      if (!sendAllAssets && outputs.length > 0) {
        for (const output of outputs) {
          previewOutputs.push({
            address: output.address,
            amount: [
              {
                unit: output.unit,
                quantity: output.amount,
              },
              ...(output.unit !== "lovelace"
                ? [
                    {
                      unit: "lovelace",
                      quantity: "1160000",
                    },
                  ]
                : []),
            ],
          });
        }
      }

      // Determine change address
      const changeAddress =
        sendAllAssets && outputs.length > 0
          ? outputs[0]!.address
          : appWallet.address;

      setPreviewTxBody({
        inputs,
        outputs: previewOutputs,
        changeAddress,
      });
    } catch (error) {
      console.error("Error building preview:", error);
      setPreviewTxBody(null);
    }
  }, [
    appWallet,
    userAddress,
    recipientAddresses,
    amounts,
    assets,
    finalSelectedUtxos,
    sendAllAssets,
    walletAssetMetadata,
    // Note: router.pathname is checked inside the effect, not in dependencies
    // to prevent infinite loops when router object changes
  ]);

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
          if (unit !== "lovelace") {
            assetMap.set(
              "lovelace",
              (Number(assetMap.get("lovelace") || 0) + 1160000).toString(),
            );
          }
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
      const paymentScript = appWallet.scriptCbor;
      if (!paymentScript) return;

      for (const utxo of selectedUtxos) {
        txBuilder
          .txIn(
            utxo.input.txHash,
            utxo.input.outputIndex,
            utxo.output.amount,
            utxo.output.address,
          )
          .txInScript(paymentScript);
      }

      if (!sendAllAssets) {
        for (let i = 0; i < outputs.length; i++) {
          txBuilder.txOut(outputs[i]!.address, [
            {
              unit: outputs[i]!.unit,
              quantity: outputs[i]!.amount,
            },
            // if unit is not lovelace, add 1160000 lovelace as native assets are not allowed to be in an output alone.
            ...(outputs[i]!.unit !== "lovelace"
              ? [
                  {
                    unit: "lovelace",
                    quantity: "1160000",
                  },
                ]
              : []),
          ]);
        }
      }

      if (sendAllAssets) {
        txBuilder.changeAddress(outputs[0]!.address);
      } else {
        txBuilder.changeAddress(appWallet.address);
      }

      console.log("txBuilder:", txBuilder.meshTxBuilderBody);

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
    setAssets([...assets, "lovelace"]);
  }

  function addSelfAsRecipient() {
    if (appWallet?.address) {
      setRecipientAddresses([...recipientAddresses, appWallet.address]);
      setAmounts([...amounts, ""]);
      setAssets([...assets, "lovelace"]);
    }
  }

  function addMultisigSignerAsRecipient(signerIndex: number) {
    if (
      appWallet?.signersAddresses &&
      appWallet.signersAddresses[signerIndex]
    ) {
      const signerAddress = appWallet.signersAddresses[signerIndex]!;
      setRecipientAddresses([...recipientAddresses, signerAddress]);
      setAmounts([...amounts, ""]);
      setAssets([...assets, "lovelace"]);
    }
  }

  // Match deposit page behavior - don't return early, handle undefined in functions that need it
  // This prevents unmount/remount cycles that cause "Cancel rendering route" errors
  
  if (!appWallet) {
    return null;
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-3 sm:gap-4 md:gap-6">
      {/* Hide title/description when used in modal (they're in DialogHeader) */}
      <div className="hidden flex-col gap-2 sm:flex">
        <SectionTitle>New Transaction</SectionTitle>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Create a new multisig transaction by specifying recipients, amounts,
          and transaction details.
        </p>
      </div>

      <div className="grid gap-3 sm:gap-4 md:gap-6">
        <CardUI title="Description" cardClassName="w-full">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                className="flex-1 text-sm sm:text-base"
                value={description}
                onChange={(e) => {
                  if (e.target.value.length <= 128)
                    setDescription(e.target.value);
                }}
                placeholder="Optional description for signers"
              />
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <QuestionMarkCircledIcon className="h-5 w-5 shrink-0 cursor-help text-muted-foreground transition-colors hover:text-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm">
                      Add a brief description to help other signers understand
                      the purpose of this transaction. This will be visible to
                      all wallet members when reviewing the transaction.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {description.length > 0 && (
              <div className="flex justify-end text-xs text-muted-foreground">
                <span
                  className={
                    description.length >= 128 ? "text-destructive" : ""
                  }
                >
                  {description.length}/128
                </span>
              </div>
            )}
          </div>
        </CardUI>

        <CardUI
          title="Recipients"
          description="Specify the recipients and amounts for your transaction"
          cardClassName="w-full"
        >
          <div className="space-y-4">
            <RecipientCsv
              setRecipientAddresses={setRecipientAddresses}
              setAmounts={setAmounts}
              setAssets={setAssets}
              recipientAddresses={recipientAddresses}
              amounts={amounts}
              assets={assets}
            />

            {/* Desktop Table */}
            <div className="hidden overflow-hidden rounded-lg border sm:block">
              <div className="overflow-x-auto">
                <Table className="min-w-[600px]">
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="min-w-[200px] font-semibold">
                        Address
                      </TableHead>
                      <TableHead className="w-[120px] font-semibold sm:w-[140px]">
                        Amount
                      </TableHead>
                      <TableHead className="w-[140px] font-semibold sm:w-[180px]">
                        Asset
                      </TableHead>
                      <TableHead className="w-[60px] sm:w-[80px]"></TableHead>
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
                        getAddressLabel={getAddressLabel}
                      />
                    ))}
                    <TableRow className="border-t-2">
                      <TableCell colSpan={4} className="py-3 sm:py-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 flex-1 gap-2 sm:h-9 sm:flex-none"
                            onClick={() => addNewRecipient()}
                            disabled={sendAllAssets}
                          >
                            <PlusCircle className="h-4 w-4" />
                            <span className="hidden sm:inline">
                              Add Recipient
                            </span>
                            <span className="sm:hidden">Add</span>
                          </Button>

                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 flex-1 gap-2 sm:h-9 sm:flex-none"
                            onClick={() => addSelfAsRecipient()}
                            disabled={sendAllAssets || !appWallet?.address}
                          >
                            <PlusCircle className="h-4 w-4" />
                            <span className="hidden sm:inline">
                              Add Self Multisig
                            </span>
                            <span className="sm:hidden">Self Multisig</span>
                          </Button>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 flex-1 gap-2 sm:h-9 sm:flex-none"
                                disabled={
                                  sendAllAssets ||
                                  !appWallet?.signersAddresses ||
                                  appWallet.signersAddresses.length === 0
                                }
                              >
                                <PlusCircle className="h-4 w-4" />
                                <span className="hidden sm:inline">
                                  Add Signer
                                </span>
                                <span className="sm:hidden">Signer</span>
                                <ChevronDown className="h-3 w-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              {appWallet?.signersAddresses?.map(
                                (signerAddress, index) => {
                                  const signerDescription =
                                    appWallet.signersDescriptions?.[index] ||
                                    `Signer ${index + 1}`;

                                  return (
                                    <DropdownMenuItem
                                      key={index}
                                      onClick={() =>
                                        addMultisigSignerAsRecipient(index)
                                      }
                                      className="flex flex-col items-start gap-1"
                                    >
                                      <span className="font-medium">
                                        {signerDescription}
                                      </span>
                                      <span className="font-mono text-xs text-muted-foreground">
                                        {signerAddress.slice(0, 20)}...
                                      </span>
                                    </DropdownMenuItem>
                                  );
                                },
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>

                          {contacts && contacts.length > 0 && (
                            <ContactsDialog
                              contacts={contacts}
                              onSelectContact={(contact) => {
                                setRecipientAddresses([
                                  ...recipientAddresses,
                                  contact.address,
                                ]);
                                setAmounts([...amounts, ""]);
                                setAssets([...assets, "lovelace"]);
                              }}
                              className="h-8 flex-1 sm:h-9 sm:flex-none"
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Mobile Card Layout */}
            <div className="block sm:hidden">
              {recipientAddresses.map((_, index) => (
                <RecipientRowMobile
                  key={index}
                  index={index}
                  recipientAddresses={recipientAddresses}
                  setRecipientAddresses={setRecipientAddresses}
                  amounts={amounts}
                  setAmounts={setAmounts}
                  assets={assets}
                  setAssets={setAssets}
                  disableAdaAmountInput={sendAllAssets}
                  getAddressLabel={getAddressLabel}
                />
              ))}

              {/* Mobile Add Buttons */}
              <div className="mt-4 space-y-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 w-full gap-2"
                  onClick={() => addNewRecipient()}
                  disabled={sendAllAssets}
                >
                  <PlusCircle className="h-4 w-4" />
                  Add Recipient
                </Button>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 gap-2"
                    onClick={() => addSelfAsRecipient()}
                    disabled={sendAllAssets || !appWallet?.address}
                  >
                    <PlusCircle className="h-4 w-4" />
                    Add Self
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 gap-2"
                        disabled={
                          sendAllAssets ||
                          !appWallet?.signersAddresses ||
                          appWallet.signersAddresses.length === 0
                        }
                      >
                        <PlusCircle className="h-4 w-4" />
                        Add Signer
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      {appWallet?.signersAddresses?.map(
                        (signerAddress, index) => {
                          const signerDescription =
                            appWallet.signersDescriptions?.[index] ||
                            `Signer ${index + 1}`;

                          return (
                            <DropdownMenuItem
                              key={index}
                              onClick={() =>
                                addMultisigSignerAsRecipient(index)
                              }
                              className="flex flex-col items-start gap-1"
                            >
                              <span className="font-medium">
                                {signerDescription}
                              </span>
                              <span className="font-mono text-xs text-muted-foreground">
                                {signerAddress.slice(0, 20)}...
                              </span>
                            </DropdownMenuItem>
                          );
                        },
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {contacts && contacts.length > 0 && (
                    <ContactsDialog
                      contacts={contacts}
                      onSelectContact={(contact) => {
                        setRecipientAddresses([
                          ...recipientAddresses,
                          contact.address,
                        ]);
                        setAmounts([...amounts, ""]);
                        setAssets([...assets, "lovelace"]);
                      }}
                      className="h-9 w-full"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardUI>

        <CardUI
          title="UTxOs"
          description="Select which unspent transaction outputs to use for this transaction and preview the transaction structure"
          cardClassName="w-full"
        >
          <div className="space-y-6">
            {/* UTxO Selector Subsection */}
            {appWallet && (
              <UTxOSelector
                appWallet={appWallet}
                network={network}
                onSelectionChange={(utxos, manual) => {
                  setManualUtxos(utxos);
                  setManualSelected(manual);
                }}
                recipientAmounts={amounts}
                recipientAssets={assets}
              />
            )}

            {/* Transaction Preview - Only show if outputs are defined */}
            {(previewTxBody?.outputs.length ?? 0) > 0 || sendAllAssets ? (
              <div>
                <h3 className="mb-3 text-sm font-semibold">
                  Transaction Preview
                </h3>
                <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
                  {/* Input UTxOs for Transaction */}
                  <div className="flex-1">
                    <h4 className="mb-2 text-xs font-medium text-muted-foreground">
                      Input UTxOs ({finalSelectedUtxos.length})
                    </h4>
                    {finalSelectedUtxos.length > 0 ? (
                      <>
                        {/* Mobile Card Layout */}
                        <div className="block space-y-2 sm:hidden">
                          {finalSelectedUtxos.map((utxo, index) => (
                            <div
                              key={`${utxo.input.txHash}-${utxo.input.outputIndex}`}
                              className="rounded-lg border-2 border-blue-500 bg-muted/20 p-3"
                            >
                              <div className="mb-2 break-all font-mono text-xs">
                                <span className="font-medium">
                                  {utxo.input.outputIndex}
                                </span>
                                <span className="text-muted-foreground">-</span>
                                <span className="break-all text-muted-foreground">
                                  {utxo.input.txHash.slice(0, 8)}...
                                  {utxo.input.txHash.slice(-8)}
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {Array.isArray(utxo.output.amount) ? (
                                  utxo.output.amount.map(
                                    (unit: any, j: number) => {
                                      const assetMetadata =
                                        walletAssetMetadata[unit.unit];
                                      const decimals =
                                        unit.unit === "lovelace"
                                          ? 6
                                          : (assetMetadata?.decimals ?? 0);
                                      const assetName =
                                        unit.unit === "lovelace"
                                          ? "₳"
                                          : assetMetadata?.ticker
                                            ? `$${truncateTokenSymbol(assetMetadata.ticker)}`
                                            : truncateTokenSymbol(unit.unit);
                                      return (
                                        <span
                                          key={unit.unit}
                                          className="text-xs font-medium"
                                        >
                                          {j > 0 && (
                                            <span className="text-muted-foreground">
                                              ,
                                            </span>
                                          )}
                                          {(
                                            parseFloat(unit.quantity) /
                                            Math.pow(10, decimals)
                                          ).toFixed(6)}{" "}
                                          {assetName}
                                        </span>
                                      );
                                    },
                                  )
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    No amount data
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Desktop Table Layout */}
                        <div className="hidden overflow-hidden rounded-lg border-2 border-blue-500 sm:block">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-muted/50">
                                <TableHead className="font-semibold">
                                  Tx Index - Hash
                                </TableHead>
                                <TableHead className="font-semibold">
                                  Outputs
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {finalSelectedUtxos.map((utxo, index) => (
                                <TableRow
                                  key={`${utxo.input.txHash}-${utxo.input.outputIndex}`}
                                >
                                  <TableCell className="font-mono text-xs">
                                    {utxo.input.outputIndex}-
                                    {utxo.input.txHash.slice(0, 10)}...
                                    {utxo.input.txHash.slice(-10)}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex flex-wrap gap-1.5">
                                      {Array.isArray(utxo.output.amount) ? (
                                        utxo.output.amount.map(
                                          (unit: any, j: number) => {
                                            const assetMetadata =
                                              walletAssetMetadata[unit.unit];
                                            const decimals =
                                              unit.unit === "lovelace"
                                                ? 6
                                                : (assetMetadata?.decimals ??
                                                  0);
                                            const assetName =
                                              unit.unit === "lovelace"
                                                ? "₳"
                                                : assetMetadata?.ticker
                                                  ? `$${truncateTokenSymbol(assetMetadata.ticker)}`
                                                  : truncateTokenSymbol(
                                                      unit.unit,
                                                    );
                                            return (
                                              <span
                                                key={unit.unit}
                                                className="text-sm"
                                              >
                                                {j > 0 && (
                                                  <span className="text-muted-foreground">
                                                    ,
                                                  </span>
                                                )}
                                                {(
                                                  parseFloat(unit.quantity) /
                                                  Math.pow(10, decimals)
                                                ).toFixed(6)}{" "}
                                                {assetName}
                                              </span>
                                            );
                                          },
                                        )
                                      ) : (
                                        <span className="text-sm text-muted-foreground">
                                          No amount data
                                        </span>
                                      )}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-lg border-2 border-blue-500 bg-muted/30 p-4">
                        <p className="text-sm text-muted-foreground">
                          {manualUtxos.length === 0
                            ? "No UTxOs selected. Use the selector above to choose UTxOs for this transaction."
                            : "Selected UTxOs will be filtered based on recipient requirements. Select UTxOs above to see them here."}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Output UTxOs */}
                  <div className="flex-1">
                    <h4 className="mb-2 text-xs font-medium text-muted-foreground">
                      Output UTxOs ({previewTxBody?.outputs.length ?? 0})
                    </h4>
                    {previewTxBody ? (
                      <div>
                        {previewTxBody.outputs.length > 0 ? (
                          <>
                            {/* Mobile Card Layout */}
                            <div className="block space-y-2 sm:hidden">
                              {previewTxBody.outputs.map((output, index) => {
                                const addressLabel = getAddressLabel(
                                  output.address,
                                );
                                return (
                                  <div
                                    key={index}
                                    className="rounded-lg border-2 border-red-500 bg-muted/20 p-3"
                                  >
                                    <div className="mb-2">
                                      {addressLabel.label && (
                                        <div className="mb-1 text-xs font-semibold">
                                          <span
                                            className={cn(
                                              addressLabel.type === "self" &&
                                                "text-blue-600 dark:text-blue-400",
                                              addressLabel.type === "signer" &&
                                                "text-green-600 dark:text-green-400",
                                              addressLabel.type === "contact" &&
                                                "text-purple-600 dark:text-purple-400",
                                            )}
                                          >
                                            {addressLabel.label}
                                          </span>
                                        </div>
                                      )}
                                      <div className="break-all font-mono text-xs text-muted-foreground">
                                        {output.address.slice(0, 12)}...
                                        {output.address.slice(-12)}
                                      </div>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                      {output.amount.map(
                                        (asset, assetIndex) => {
                                          const assetMetadata =
                                            walletAssetMetadata[asset.unit];
                                          const decimals =
                                            asset.unit === "lovelace"
                                              ? 6
                                              : (assetMetadata?.decimals ?? 0);
                                          const assetName =
                                            asset.unit === "lovelace"
                                              ? "₳"
                                              : assetMetadata?.ticker
                                                ? `$${truncateTokenSymbol(assetMetadata.ticker)}`
                                                : truncateTokenSymbol(
                                                    asset.unit,
                                                  );
                                          const formattedAmount = (
                                            parseFloat(asset.quantity) /
                                            Math.pow(10, decimals)
                                          ).toFixed(6);
                                          return (
                                            <span
                                              key={assetIndex}
                                              className="text-xs font-medium"
                                            >
                                              {formattedAmount} {assetName}
                                            </span>
                                          );
                                        },
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Desktop Table Layout */}
                            <div className="hidden overflow-hidden rounded-lg border-2 border-red-500 sm:block">
                              <Table>
                                <TableHeader>
                                  <TableRow className="bg-muted/50">
                                    <TableHead className="font-semibold">
                                      Address
                                    </TableHead>
                                    <TableHead className="font-semibold">
                                      Amount
                                    </TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {previewTxBody.outputs.map(
                                    (output, index) => {
                                      const addressLabel = getAddressLabel(
                                        output.address,
                                      );
                                      return (
                                        <TableRow key={index}>
                                          <TableCell>
                                            <div className="flex flex-col gap-1">
                                              {addressLabel.label && (
                                                <div className="text-xs font-semibold">
                                                  <span
                                                    className={cn(
                                                      addressLabel.type ===
                                                        "self" &&
                                                        "text-blue-600 dark:text-blue-400",
                                                      addressLabel.type ===
                                                        "signer" &&
                                                        "text-green-600 dark:text-green-400",
                                                      addressLabel.type ===
                                                        "contact" &&
                                                        "text-purple-600 dark:text-purple-400",
                                                    )}
                                                  >
                                                    {addressLabel.label}
                                                  </span>
                                                </div>
                                              )}
                                              <div className="font-mono text-xs text-muted-foreground">
                                                {output.address.slice(0, 20)}...
                                                {output.address.slice(-20)}
                                              </div>
                                            </div>
                                          </TableCell>
                                          <TableCell>
                                            <div className="flex flex-col gap-1">
                                              {output.amount.map(
                                                (asset, assetIndex) => {
                                                  const assetMetadata =
                                                    walletAssetMetadata[
                                                      asset.unit
                                                    ];
                                                  const decimals =
                                                    asset.unit === "lovelace"
                                                      ? 6
                                                      : (assetMetadata?.decimals ??
                                                        0);
                                                  const assetName =
                                                    asset.unit === "lovelace"
                                                      ? "₳"
                                                      : assetMetadata?.ticker
                                                        ? `$${truncateTokenSymbol(assetMetadata.ticker)}`
                                                        : truncateTokenSymbol(
                                                            asset.unit,
                                                          );
                                                  const formattedAmount = (
                                                    parseFloat(asset.quantity) /
                                                    Math.pow(10, decimals)
                                                  ).toFixed(6);
                                                  return (
                                                    <span
                                                      key={assetIndex}
                                                      className="text-sm"
                                                    >
                                                      {formattedAmount}{" "}
                                                      {assetName}
                                                    </span>
                                                  );
                                                },
                                              )}
                                            </div>
                                          </TableCell>
                                        </TableRow>
                                      );
                                    },
                                  )}
                                </TableBody>
                              </Table>
                            </div>
                          </>
                        ) : sendAllAssets ? (
                          <div className="rounded-lg border-2 border-red-500 bg-muted/30 p-4">
                            <p className="text-sm text-muted-foreground">
                              All assets will be sent to:{" "}
                              <span className="font-mono text-xs">
                                {previewTxBody.changeAddress?.slice(0, 20)}...
                                {previewTxBody.changeAddress?.slice(-20)}
                              </span>
                            </p>
                          </div>
                        ) : (
                          <div className="rounded-lg border-2 border-red-500 bg-muted/30 p-4">
                            <p className="text-sm text-muted-foreground">
                              No outputs defined
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Configure recipients and select UTxOs to see preview
                      </p>
                    )}
                  </div>
                </div>

                {/* Change Address - Below both sections */}
                {previewTxBody?.changeAddress &&
                  !sendAllAssets &&
                  (() => {
                    const changeAddressLabel = getAddressLabel(
                      previewTxBody.changeAddress,
                    );
                    return (
                      <div className="mt-4">
                        <h4 className="mb-2 text-xs font-medium text-muted-foreground">
                          Change Address
                        </h4>
                        <div className="rounded-lg border bg-muted/30 p-3">
                          {changeAddressLabel.label && (
                            <div className="mb-1 text-xs font-semibold">
                              <span
                                className={cn(
                                  changeAddressLabel.type === "self" &&
                                    "text-blue-600 dark:text-blue-400",
                                  changeAddressLabel.type === "signer" &&
                                    "text-green-600 dark:text-green-400",
                                  changeAddressLabel.type === "contact" &&
                                    "text-purple-600 dark:text-purple-400",
                                )}
                              >
                                {changeAddressLabel.label}
                              </span>
                            </div>
                          )}
                          <p className="break-all font-mono text-xs text-muted-foreground">
                            {previewTxBody.changeAddress}
                          </p>
                        </div>
                      </div>
                    );
                  })()}
              </div>
            ) : null}
          </div>
        </CardUI>

        <CardUI
          title="On-chain Metadata"
          description="Attach additional information to the transaction that will be visible on the blockchain"
          cardClassName="w-full"
        >
          <div className="space-y-3">
            <Textarea
              className="min-h-16 resize-none text-sm sm:min-h-20 sm:text-base"
              value={metadata}
              onChange={(e) => {
                if (e.target.value.length <= 64) setMetadata(e.target.value);
              }}
              placeholder="e.g., PR #123, Invoice #456, etc."
            />
            <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-0">
              <span>Optional metadata for blockchain record</span>
              <span className={metadata.length >= 64 ? "text-destructive" : ""}>
                {metadata.length}/64
              </span>
            </div>
            {metadata.length >= 64 && (
              <p className="text-sm text-destructive">
                Metadata should be less than 64 characters
              </p>
            )}
          </div>
        </CardUI>

        <CardUI
          title="Transaction Options"
          description="Configure additional settings for your transaction"
          cardClassName="w-full"
        >
          <div className="space-y-4">
            <div className="flex items-start space-x-3 rounded-lg border bg-muted/30 p-3 sm:p-4">
              <Checkbox
                id="sendAllAssetCheck"
                checked={sendAllAssets}
                onCheckedChange={() => setSendAllAssets(!sendAllAssets)}
                className="mt-0.5 flex-shrink-0"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <label
                  htmlFor="sendAllAssetCheck"
                  className="flex cursor-pointer items-start gap-2 text-sm font-medium leading-relaxed peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  <span className="flex-1">
                    Send all assets to first recipient
                  </span>
                  <HoverCard>
                    <HoverCardTrigger className="flex-shrink-0">
                      <QuestionMarkCircledIcon className="h-4 w-4 text-muted-foreground transition-colors hover:text-foreground" />
                    </HoverCardTrigger>
                    <HoverCardContent className="w-80 max-w-[calc(100vw-2rem)]">
                      <div className="space-y-2">
                        <h4 className="font-semibold">Send All Assets</h4>
                        <p className="text-sm">
                          When enabled, all assets in the wallet will be sent to
                          the first recipient's address. This is useful for
                          wallet consolidation or complete asset transfers.
                        </p>
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                </label>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Transfers all wallet assets to the first recipient instead of
                  specific amounts
                </p>
              </div>
            </div>
          </div>
        </CardUI>

        <div className="flex flex-col items-center gap-4 border-t pt-4 sm:pt-6">
          {error && (
            <div className="w-full max-w-md rounded-lg border border-destructive/20 bg-destructive/5 p-3 sm:p-4">
              <div className="flex items-center gap-2 text-destructive">
                <X className="h-4 w-4 flex-shrink-0" />
                <span className="text-sm font-medium">Transaction Error</span>
              </div>
              <p className="mt-1 break-words text-sm text-destructive/80">
                {error}
              </p>
            </div>
          )}

          <Button
            onClick={() => createNewTransaction()}
            disabled={loading}
            size="lg"
            className="h-11 w-full sm:h-12 sm:w-auto sm:min-w-[200px]"
          >
            {loading ? (
              <>
                <Loader className="mr-2 h-4 w-4 animate-spin" />
                <span className="hidden sm:inline">
                  Creating Transaction...
                </span>
                <span className="sm:hidden">Creating...</span>
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Create Transaction</span>
                <span className="sm:hidden">Create</span>
              </>
            )}
          </Button>

          <p className="max-w-md px-4 text-center text-xs leading-relaxed text-muted-foreground">
            This will create a multisig transaction that requires signatures
            from other wallet members
          </p>
        </div>
      </div>
    </div>
  );
}

// Contacts Dialog Component
function ContactsDialog({
  contacts,
  onSelectContact,
  className,
}: {
  contacts: Array<{
    id: string;
    name: string;
    address: string;
    description?: string | null;
  }>;
  onSelectContact: (contact: { address: string }) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (contacts.length === 0) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={cn("gap-2", className)}>
          <UserPlus className="h-4 w-4" />
          <span className="hidden sm:inline">Add from Contacts</span>
          <span className="sm:hidden">Contacts</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Select Contact</DialogTitle>
          <DialogDescription>
            Choose a contact to add as a recipient
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[400px] overflow-y-auto">
          {contacts.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No contacts available
            </p>
          ) : (
            <div className="space-y-2">
              {contacts.map((contact) => (
                <button
                  key={contact.id}
                  onClick={() => {
                    onSelectContact(contact);
                    setOpen(false);
                  }}
                  className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="font-medium">{contact.name}</div>
                  {contact.description && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {contact.description}
                    </div>
                  )}
                  <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {contact.address.slice(0, 20)}...
                    {contact.address.slice(-20)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
