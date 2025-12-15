import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import CardUI from "@/components/ui/card-content";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ArrowLeft,
  ArrowRight,
  Loader,
  AlertCircle,
  CheckCircle,
  Send,
} from "lucide-react";
import { Wallet } from "@/types/wallet";
import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { useSiteStore } from "@/lib/zustand/site";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { toast } from "@/hooks/use-toast";
import useTransaction from "@/hooks/useTransaction";
import { getProvider } from "@/utils/get-provider";
import { getTxBuilder } from "@/utils/get-tx-builder";
import { getBalanceFromUtxos } from "@/utils/getBalance";
import { numberWithCommas } from "@/utils/strings";
import {
  MultisigWallet,
  paymentKeyHash,
  stakeKeyHash,
} from "@/utils/multisigSDK";

interface FundTransferStepProps {
  appWallet: Wallet;
  newWalletId: string;
  onBack: () => void;
  onContinue: () => void;
}

export default function FundTransferStep({
  appWallet,
  newWalletId,
  onBack,
  onContinue,
}: FundTransferStepProps) {
  const userAddress = useUserStore((state) => state.userAddress);
  const network = useSiteStore((state) => state.network);
  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);
  const walletAssets = useWalletsStore((state) => state.walletAssets);
  const { newTransaction } = useTransaction();

  // State
  const [newWallet, setNewWallet] = useState<any>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferComplete, setTransferComplete] = useState(false);
  const [transferTxId, setTransferTxId] = useState<string | null>(null);

  // Get current wallet data
  const currentUtxos = walletsUtxos[appWallet.id] || [];
  const currentBalance = getBalanceFromUtxos(currentUtxos);
  const nonAdaAssets =
    walletAssets?.filter((asset) => asset.unit !== "lovelace") || [];

  // Generate new wallet address using MultisigWallet SDK
  const generateNewWalletAddress = (walletData: any): string | null => {
    if (
      !walletData ||
      !walletData.signersAddresses ||
      walletData.signersAddresses.length === 0
    ) {
      return null;
    }

    try {
      // Extract key hashes from addresses and stake keys
      const keys: Array<{ keyHash: string; role: number; name: string }> = [];

      // Add payment keys (role 0)
      walletData.signersAddresses.forEach((address: string, index: number) => {
        const keyHash = paymentKeyHash(address);
        keys.push({
          keyHash,
          role: 0, // Payment key role
          name:
            walletData.signersDescriptions?.[index] || `Signer ${index + 1}`,
        });
      });

      // Add stake keys (role 2) if they exist
      if (
        walletData.signersStakeKeys &&
        walletData.signersStakeKeys.length > 0
      ) {
        walletData.signersStakeKeys.forEach(
          (stakeKey: string, index: number) => {
            if (stakeKey && stakeKey.trim() !== "") {
              const keyHash = stakeKeyHash(stakeKey);
              keys.push({
                keyHash,
                role: 2, // Stake key role
                name: `${walletData.signersDescriptions?.[index] || `Signer ${index + 1}`} Stake`,
              });
            }
          },
        );
      }

      // Create MultisigWallet instance with the new wallet data
      const multisigWallet = new MultisigWallet(
        walletData.name || "New Wallet",
        keys,
        walletData.description || "",
        walletData.numRequiredSigners || 1,
        network === 0 ? 0 : 1, // 0=testnet, 1=mainnet
        walletData.stakeCredentialHash || undefined,
        walletData.scriptType || "atLeast",
      );

      // Generate the script and get the address
      const { address } = multisigWallet.getScript();
      return address;
    } catch (error) {
      console.error("Failed to generate new wallet address:", error);
      return null;
    }
  };

  // Load new wallet information - try both Wallet and NewWallet tables
  const {
    data: newWalletData,
    isLoading: isLoadingNewWalletData,
    error: newWalletError,
  } = api.wallet.getWallet.useQuery(
    {
      address: userAddress!,
      walletId: newWalletId,
    },
    {
      enabled: !!newWalletId && !!userAddress,
      retry: false, // Don't retry if wallet doesn't exist
    },
  );

  // Fallback to NewWallet if Wallet query fails
  const {
    data: newWalletDataFallback,
    isLoading: isLoadingNewWalletDataFallback,
    error: newWalletErrorFallback,
  } = api.wallet.getNewWallet.useQuery(
    {
      walletId: newWalletId,
    },
    {
      enabled: !!newWalletId && !!newWalletError && !isLoadingNewWalletData,
      retry: false,
    },
  );

  useEffect(() => {

    if (newWalletData) {
      setNewWallet(newWalletData);
    } else if (newWalletDataFallback) {
      // Convert NewWallet data to Wallet format for compatibility
      const walletData = {
        ...newWalletDataFallback,
        address: newWalletDataFallback.signersAddresses?.[0] || "", // Use first signer address as wallet address
        scriptCbor: "", // NewWallet doesn't have scriptCbor
        type: newWalletDataFallback.scriptType || "atLeast",
        verified: [],
        isArchived: false,
        clarityApiKey: null,
        migrationTargetWalletId: null,
      };
      setNewWallet(walletData);
      } else if (newWalletError && newWalletErrorFallback) {
      toast({
        title: "Error",
        description:
          "Failed to load new wallet information. The new wallet may not exist yet.",
        variant: "destructive",
      });
    }
  }, [
    newWalletData,
    newWalletError,
    newWalletDataFallback,
    newWalletErrorFallback,
    newWalletId,
    userAddress,
    isLoadingNewWalletData,
    isLoadingNewWalletDataFallback,
  ]);

  const handleTransferAllFunds = async () => {
    if (!newWallet || !userAddress) return;

    setIsTransferring(true);
    try {
      const blockchainProvider = getProvider(network);
      const utxos = await blockchainProvider.fetchAddressUTxOs(
        appWallet.address,
      );

      if (utxos.length === 0) {
        toast({
          title: "No Funds to Transfer",
          description: "There are no funds in the current wallet to transfer. You can continue to the next step.",
        });
        // Automatically proceed to the next step when there are no funds
        setTimeout(() => {
          onContinue();
        }, 2000); // 2 second delay to show the message
        return;
      }

      const txBuilder = getTxBuilder(network);

      // Add all UTxOs as inputs
      for (const utxo of utxos) {
        txBuilder.txIn(
          utxo.input.txHash,
          utxo.input.outputIndex,
          utxo.output.amount,
          utxo.output.address,
        );
        txBuilder.txInScript(appWallet.scriptCbor);
      }

      // Generate new wallet address using MultisigWallet SDK
      const newWalletAddress = generateNewWalletAddress(newWallet);
      if (!newWalletAddress) {
        throw new Error("Failed to generate new wallet address");
      }
      //filter one utxo with just lovelace no other units and remove it from the utxos array to pay the fee
      const lovelaceUtxo = utxos.find(
        (utxo) =>
          utxo.output.amount.find(
            (asset: { unit: string; quantity: string }) =>
              asset.unit === "lovelace",
          ) &&
          utxo.output.amount.find(
            (asset: { unit: string; quantity: string }) =>
              asset.unit !== "lovelace",
          ) === undefined,
      );
      if (lovelaceUtxo) {
        utxos.splice(utxos.indexOf(lovelaceUtxo), 1); //remove the lovelace utxo from the utxos array to pay the fee
      }

      for (const utxo of utxos) {
        txBuilder.txOut(newWalletAddress, utxo.output.amount);
      }

      txBuilder.changeAddress(newWalletAddress);
      // Create the transaction with the lovelace utxo to pay the fee
      await newTransaction({
        txBuilder,
        description: "Migration: Transfer all funds to new wallet",
        toastMessage: "Fund transfer transaction created successfully",
      });

      setTransferComplete(true);
      toast({
        title: "Transfer Initiated",
        description:
          "Fund transfer transaction has been created and is pending signatures.",
      });

      // Automatically proceed to the next step after a short delay
      setTimeout(() => {
        onContinue();
      }, 2000); // 2 second delay to show the success message
    } catch (error) {
      console.error("Failed to transfer funds:", error);
      toast({
        title: "Transfer Failed",
        description: "Failed to create fund transfer transaction.",
        variant: "destructive",
      });
    } finally {
      setIsTransferring(false);
    }
  };

  if (isLoadingNewWalletData || isLoadingNewWalletDataFallback) {
    return (
      <CardUI
        title="Loading New Wallet"
        description="Loading new wallet information..."
        cardClassName="col-span-2"
      >
        <div className="flex items-center justify-center py-8">
          <Loader className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading new wallet information...</span>
        </div>
      </CardUI>
    );
  }

  if (newWalletError) {
    return (
      <CardUI
        title="Error Loading New Wallet"
        description="Unable to load the new wallet information"
        cardClassName="col-span-2"
      >
        <Alert className="border-red-200/50 bg-red-50 dark:border-red-800/50 dark:bg-red-900/20">
          <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
          <AlertDescription className="text-red-800 dark:text-red-200">
            The new wallet could not be loaded. This might happen if the wallet
            hasn't been created yet or if there's a connection issue.
          </AlertDescription>
        </Alert>
        <div className="flex gap-3 pt-4">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Proxy Setup
          </Button>
        </div>
      </CardUI>
    );
  }

  if (!newWallet || !newWallet.id) {
    return (
      <CardUI
        title="Error"
        description="Failed to load new wallet"
        cardClassName="col-span-2"
      >
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load new wallet information. Please ensure the new wallet
            was created successfully.
          </AlertDescription>
        </Alert>
        <div className="flex gap-3 pt-4">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </div>
      </CardUI>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <CardUI
        title="Step 4: Transfer Funds"
        description="Move all funds from your current wallet to the new wallet"
        cardClassName="col-span-2"
      >
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            This will transfer all funds from your current wallet to the new
            wallet. This action cannot be undone.
          </AlertDescription>
        </Alert>
      </CardUI>

      {/* Current Wallet Balance */}
      <CardUI
        title="Current Wallet Balance"
        description="Funds to be transferred"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border/30 p-4">
            <div>
              <h4 className="font-medium">ADA Balance</h4>
              <p className="text-sm text-muted-foreground">Native currency</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold">
                {currentBalance
                  ? numberWithCommas(Number(currentBalance)) + " ₳"
                  : "0.00 ₳"}
              </p>
            </div>
          </div>

          {nonAdaAssets.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium">Other Assets</h4>
              {nonAdaAssets.map((asset, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between rounded-lg border border-border/30 p-3"
                >
                  <div>
                    <p className="font-medium">{asset.unit}</p>
                    <p className="text-sm text-muted-foreground">
                      Custom asset
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{asset.quantity}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {currentUtxos.length === 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-border/30 bg-blue-50 p-4 dark:bg-blue-900/20">
              <CheckCircle className="h-5 w-5 text-blue-500 dark:text-blue-400" />
              <div>
                <h4 className="font-medium">No Funds to Transfer</h4>
                <p className="text-sm text-muted-foreground">
                  The current wallet has no funds to transfer. You can continue to the next step.
                </p>
              </div>
            </div>
          )}
        </div>
      </CardUI>

      {/* New Wallet Information */}
      <CardUI title="New Wallet" description="Destination for the funds">
        <div className="space-y-4">
          <div className="rounded-lg border border-border/30 p-4">
            <h4 className="mb-2 font-medium">Wallet Details</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Name:</span>
                <span className="font-medium">
                  {newWallet?.name || "Loading..."}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Address:</span>
                <span className="font-mono text-xs">
                  {newWallet
                    ? (() => {
                        const address = generateNewWalletAddress(newWallet);
                        return address
                          ? `${address.slice(0, 20)}...`
                          : "Generating...";
                      })()
                    : "Loading..."}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Signers:</span>
                <span className="font-medium">
                  {newWallet?.signersAddresses?.length || 0}
                </span>
              </div>
            </div>
          </div>
        </div>
      </CardUI>

      {/* Transfer Status */}
      {transferComplete && (
        <CardUI
          title="Transfer Complete"
          description="Fund transfer has been initiated"
        >
          <div className="flex items-center gap-3 rounded-lg border border-border/30 bg-green-50 p-4 dark:bg-green-900/20">
            <CheckCircle className="h-5 w-5 text-green-500 dark:text-green-400" />
            <div>
              <h4 className="font-medium">Transfer Initiated</h4>
              <p className="text-sm text-muted-foreground">
                The fund transfer transaction has been created and is pending
                signatures. You can view it in the transactions section.
              </p>
            </div>
          </div>
        </CardUI>
      )}

      {/* Action Buttons */}
      <CardUI
        title="Transfer Funds"
        description="Complete the fund transfer"
        cardClassName="col-span-2"
      >
        <div className="flex gap-3 border-t border-border/30 pt-4">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Proxy Setup
          </Button>
          {!transferComplete ? (
            <Button
              onClick={handleTransferAllFunds}
              disabled={isTransferring}
              className="flex-1"
            >
              {isTransferring ? (
                <>
                  <Loader className="mr-2 h-4 w-4 animate-spin" />
                  Transferring...
                </>
              ) : currentUtxos.length === 0 ? (
                <>
                  <ArrowRight className="mr-2 h-4 w-4" />
                  Continue (No Funds)
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Transfer All Funds
                </>
              )}
            </Button>
          ) : (
            <Button disabled className="flex-1">
              <Loader className="mr-2 h-4 w-4 animate-spin" />
              Proceeding to Next Step...
            </Button>
          )}
        </div>
      </CardUI>
    </div>
  );
}
