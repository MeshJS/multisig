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

import { Loader, PlusCircle, Send, X, ChevronDown } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import UTxOSelector from "./utxoSelector";
import RecipientRow from "./RecipientRow";
import RecipientRowMobile from "./RecipientRowMobile";
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
  const [assets, setAssets] = useState<string[]>(["lovelace"]);
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


      if (!sendAllAssets) {
        for (let i = 0; i < outputs.length; i++) {
          txBuilder.txOut(outputs[i]!.address, [
            {
              unit: outputs[i]!.unit,
              quantity: outputs[i]!.amount,
            },
            // if unit is not lovelace, add 1160000 lovelace as native assets are not allowed to be in an output alone.
            ...(outputs[i]!.unit !== "lovelace" ? [{
              unit: "lovelace",
              quantity: "1160000",
            }] : [])
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
    if (appWallet?.signersAddresses && appWallet.signersAddresses[signerIndex]) {
      const signerAddress = appWallet.signersAddresses[signerIndex]!;
      setRecipientAddresses([...recipientAddresses, signerAddress]);
      setAmounts([...amounts, ""]);
      setAssets([...assets, "lovelace"]);
    }
  }

  return (
    <main className="pointer-events-auto flex flex-1 flex-col gap-4 p-3 sm:gap-6 sm:p-4 md:gap-8 md:p-8 max-w-6xl mx-auto">
      <div className="flex flex-col gap-2">
        <SectionTitle>New Transaction</SectionTitle>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Create a new multisig transaction by specifying recipients, amounts, and transaction details.
        </p>
      </div>

      <div className="grid gap-4 sm:gap-6">
        <CardUI 
          title="Description"
          description="Provide context and information for other signers about this transaction"
          cardClassName="w-full"
        >
          <div className="space-y-3">
            <Textarea
              className="min-h-16 sm:min-h-20 resize-none text-sm sm:text-base"
              value={description}
              onChange={(e) => {
                if (e.target.value.length <= 128)
                  setDescription(e.target.value);
              }}
              placeholder="e.g., Payment for services, Contribution to project, etc."
            />
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 sm:gap-0 text-xs text-muted-foreground">
              <span>Optional description for signers</span>
              <span className={description.length >= 128 ? "text-destructive" : ""}>
                {description.length}/128
              </span>
            </div>
            {description.length >= 128 && (
              <p className="text-sm text-destructive">
                Description should be less than 128 characters
              </p>
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
            <div className="hidden sm:block border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <Table className="min-w-[600px]">
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-semibold min-w-[200px]">Address</TableHead>
                      <TableHead className="w-[120px] sm:w-[140px] font-semibold">Amount</TableHead>
                      <TableHead className="w-[140px] sm:w-[180px] font-semibold">Asset</TableHead>
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
                      />
                    ))}
                    <TableRow className="border-t-2">
                      <TableCell colSpan={4} className="py-3 sm:py-4">
                        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-2 h-8 sm:h-9 flex-1 sm:flex-none"
                            onClick={() => addNewRecipient()}
                            disabled={sendAllAssets}
                          >
                            <PlusCircle className="h-4 w-4" />
                            <span className="hidden sm:inline">Add Recipient</span>
                            <span className="sm:hidden">Add</span>
                          </Button>
                          
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-2 h-8 sm:h-9 flex-1 sm:flex-none"
                            onClick={() => addSelfAsRecipient()}
                            disabled={sendAllAssets || !appWallet?.address}
                          >
                            <PlusCircle className="h-4 w-4" />
                            <span className="hidden sm:inline">Add Self Multisig</span>
                            <span className="sm:hidden">Self Multisig</span>
                          </Button>
                          
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-2 h-8 sm:h-9 flex-1 sm:flex-none"
                                disabled={sendAllAssets || !appWallet?.signersAddresses || appWallet.signersAddresses.length === 0}
                              >
                                <PlusCircle className="h-4 w-4" />
                                <span className="hidden sm:inline">Add Signer</span>
                                <span className="sm:hidden">Signer</span>
                                <ChevronDown className="h-3 w-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              {appWallet?.signersAddresses?.map((signerAddress, index) => {
                                const signerDescription = appWallet.signersDescriptions?.[index] || `Signer ${index + 1}`;

                                return (
                                  <DropdownMenuItem
                                    key={index}
                                    onClick={() => addMultisigSignerAsRecipient(index)}
                                    className="flex flex-col items-start gap-1"
                                  >
                                    <span className="font-medium">{signerDescription}</span>
                                    <span className="text-xs text-muted-foreground font-mono">
                                      {signerAddress.slice(0, 20)}...
                                    </span>
                                  </DropdownMenuItem>
                                );
                              })}
                            </DropdownMenuContent>
                          </DropdownMenu>
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
                />
              ))}
              
              {/* Mobile Add Buttons */}
              <div className="mt-4 space-y-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 h-9 w-full"
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
                    className="gap-2 h-9"
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
                        className="gap-2 h-9"
                        disabled={sendAllAssets || !appWallet?.signersAddresses || appWallet.signersAddresses.length === 0}
                      >
                        <PlusCircle className="h-4 w-4" />
                        Add Signer
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      {appWallet?.signersAddresses?.map((signerAddress, index) => {
                        const signerDescription = appWallet.signersDescriptions?.[index] || `Signer ${index + 1}`;

                        return (
                          <DropdownMenuItem
                            key={index}
                            onClick={() => addMultisigSignerAsRecipient(index)}
                            className="flex flex-col items-start gap-1"
                          >
                            <span className="font-medium">{signerDescription}</span>
                            <span className="text-xs text-muted-foreground font-mono">
                              {signerAddress.slice(0, 20)}...
                            </span>
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          </div>
        </CardUI>

      <CardUI 
        title="UTxOs" 
        description="Select which unspent transaction outputs to use for this transaction"
        cardClassName="w-full"
      >
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
      </CardUI>

      <CardUI
        title="On-chain Metadata"
        description="Attach additional information to the transaction that will be visible on the blockchain"
        cardClassName="w-full"
      >
        <div className="space-y-3">
          <Textarea
            className="min-h-16 sm:min-h-20 resize-none text-sm sm:text-base"
            value={metadata}
            onChange={(e) => {
              if (e.target.value.length <= 64)
                setMetadata(e.target.value);
            }}
            placeholder="e.g., PR #123, Invoice #456, etc."
          />
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 sm:gap-0 text-xs text-muted-foreground">
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
          <div className="flex items-start space-x-3 p-3 sm:p-4 border rounded-lg bg-muted/30">
            <Checkbox
              id="sendAllAssetCheck"
              checked={sendAllAssets}
              onCheckedChange={() => setSendAllAssets(!sendAllAssets)}
              className="mt-0.5 flex-shrink-0"
            />
            <div className="flex-1 space-y-1 min-w-0">
              <label
                htmlFor="sendAllAssetCheck"
                className="flex items-start gap-2 text-sm font-medium leading-relaxed peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                <span className="flex-1">Send all assets to first recipient</span>
                <HoverCard>
                  <HoverCardTrigger className="flex-shrink-0">
                    <QuestionMarkCircledIcon className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors" />
                  </HoverCardTrigger>
                  <HoverCardContent className="w-80 max-w-[calc(100vw-2rem)]">
                    <div className="space-y-2">
                      <h4 className="font-semibold">Send All Assets</h4>
                      <p className="text-sm">
                        When enabled, all assets in the wallet will be sent to the first recipient's address. 
                        This is useful for wallet consolidation or complete asset transfers.
                      </p>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              </label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Transfers all wallet assets to the first recipient instead of specific amounts
              </p>
            </div>
          </div>
        </div>
      </CardUI>

      <div className="flex flex-col items-center gap-4 pt-4 sm:pt-6 border-t">
        {error && (
          <div className="w-full max-w-md p-3 sm:p-4 border border-destructive/20 bg-destructive/5 rounded-lg">
            <div className="flex items-center gap-2 text-destructive">
              <X className="h-4 w-4 flex-shrink-0" />
              <span className="text-sm font-medium">Transaction Error</span>
            </div>
            <p className="text-sm text-destructive/80 mt-1 break-words">{error}</p>
          </div>
        )}
        
        <Button 
          onClick={() => createNewTransaction()} 
          disabled={loading}
          size="lg"
          className="w-full sm:min-w-[200px] sm:w-auto h-11 sm:h-12"
        >
          {loading ? (
            <>
              <Loader className="mr-2 h-4 w-4 animate-spin" />
              <span className="hidden sm:inline">Creating Transaction...</span>
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
        
        <p className="text-xs text-muted-foreground text-center max-w-md px-4 leading-relaxed">
          This will create a multisig transaction that requires signatures from other wallet members
        </p>
      </div>
      </div>
    </main>
  );
}