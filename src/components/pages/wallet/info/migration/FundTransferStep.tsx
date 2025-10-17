import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import CardUI from "@/components/ui/card-content";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, ArrowRight, Loader, AlertCircle, CheckCircle, Send } from "lucide-react";
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
  onContinue
}: FundTransferStepProps) {
  const userAddress = useUserStore((state) => state.userAddress);
  const network = useSiteStore((state) => state.network);
  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);
  const walletAssets = useWalletsStore((state) => state.walletAssets);
  const { newTransaction } = useTransaction();

  // State
  const [newWallet, setNewWallet] = useState<any>(null);
  const [isLoadingNewWallet, setIsLoadingNewWallet] = useState(true);
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferComplete, setTransferComplete] = useState(false);
  const [transferTxId, setTransferTxId] = useState<string | null>(null);

  // Get current wallet data
  const currentUtxos = walletsUtxos[appWallet.id] || [];
  const currentBalance = getBalanceFromUtxos(currentUtxos);
  const nonAdaAssets = walletAssets?.filter((asset) => asset.unit !== "lovelace") || [];

  // Load new wallet information
  const { data: newWalletData, isLoading: isLoadingNewWalletData, error: newWalletError } = api.wallet.getWallet.useQuery(
    {
      address: userAddress!,
      walletId: newWalletId,
    },
    {
      enabled: !!newWalletId && !!userAddress,
      retry: false, // Don't retry if wallet doesn't exist
    }
  );

  useEffect(() => {
    if (newWalletData) {
      setNewWallet(newWalletData);
      setIsLoadingNewWallet(false);
    } else if (newWalletError) {
      console.error("Failed to load new wallet:", newWalletError);
      setIsLoadingNewWallet(false);
      toast({
        title: "Error",
        description: "Failed to load new wallet information. The new wallet may not exist yet.",
        variant: "destructive",
      });
    }
  }, [newWalletData, newWalletError]);

  const handleTransferAllFunds = async () => {
    if (!newWallet || !userAddress) return;

    setIsTransferring(true);
    try {
      const blockchainProvider = getProvider(network);
      const utxos = await blockchainProvider.fetchAddressUTxOs(appWallet.address);

      if (utxos.length === 0) {
        toast({
          title: "No Funds to Transfer",
          description: "There are no funds in the current wallet to transfer.",
          variant: "destructive",
        });
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

      // Set new wallet address as change address (sends everything there)
      txBuilder.changeAddress(newWallet.address);

      // Create the transaction
      await newTransaction({
        txBuilder,
        description: "Migration: Transfer all funds to new wallet",
        toastMessage: "Fund transfer transaction created successfully",
      });

      setTransferComplete(true);
      toast({
        title: "Transfer Initiated",
        description: "Fund transfer transaction has been created and is pending signatures.",
      });
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

  if (isLoadingNewWalletData) {
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
        <Alert className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20">
          <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
          <AlertDescription className="text-red-800 dark:text-red-200">
            The new wallet could not be loaded. This might happen if the wallet hasn't been created yet or if there's a connection issue.
          </AlertDescription>
        </Alert>
        <div className="flex gap-3 pt-4">
          <Button
            variant="outline"
            onClick={onBack}
            className="flex-1"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Proxy Setup
          </Button>
        </div>
      </CardUI>
    );
  }

  if (!newWallet) {
    return (
      <CardUI
        title="Error"
        description="Failed to load new wallet"
        cardClassName="col-span-2"
      >
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load new wallet information. Please ensure the new wallet was created successfully.
          </AlertDescription>
        </Alert>
        <div className="flex gap-3 pt-4">
          <Button variant="outline" onClick={onBack} className="flex-1">
            <ArrowLeft className="h-4 w-4 mr-2" />
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
            This will transfer all funds from your current wallet to the new wallet. 
            This action cannot be undone.
          </AlertDescription>
        </Alert>
      </CardUI>

      {/* Current Wallet Balance */}
      <CardUI
        title="Current Wallet Balance"
        description="Funds to be transferred"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <h4 className="font-medium">ADA Balance</h4>
              <p className="text-sm text-muted-foreground">Native currency</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold">
                {currentBalance ? numberWithCommas(currentBalance.toFixed(2)) : "0.00"} ₳
              </p>
            </div>
          </div>

          {nonAdaAssets.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium">Other Assets</h4>
              {nonAdaAssets.map((asset, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="font-medium">{asset.unit}</p>
                    <p className="text-sm text-muted-foreground">Custom asset</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{asset.quantity}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {currentUtxos.length === 0 && (
            <div className="flex items-center gap-3 p-4 border rounded-lg bg-gray-50 dark:bg-gray-800">
              <AlertCircle className="h-5 w-5 text-gray-500 dark:text-gray-400" />
              <div>
                <h4 className="font-medium">No Funds</h4>
                <p className="text-sm text-muted-foreground">
                  There are no funds in the current wallet to transfer.
                </p>
              </div>
            </div>
          )}
        </div>
      </CardUI>

      {/* New Wallet Information */}
      <CardUI
        title="New Wallet"
        description="Destination for the funds"
      >
        <div className="space-y-4">
          <div className="p-4 border rounded-lg">
            <h4 className="font-medium mb-2">Wallet Details</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Name:</span>
                <span className="font-medium">{newWallet.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Address:</span>
                <span className="font-mono text-xs">{newWallet.address.slice(0, 20)}...</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Signers:</span>
                <span className="font-medium">{newWallet.signersAddresses.length}</span>
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
          <div className="flex items-center gap-3 p-4 border rounded-lg bg-green-50 dark:bg-green-900/20">
            <CheckCircle className="h-5 w-5 text-green-500 dark:text-green-400" />
            <div>
              <h4 className="font-medium">Transfer Initiated</h4>
              <p className="text-sm text-muted-foreground">
                The fund transfer transaction has been created and is pending signatures.
                You can view it in the transactions section.
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
        <div className="flex gap-3 pt-4 border-t">
          <Button
            variant="outline"
            onClick={onBack}
            className="flex-1"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Proxy Setup
          </Button>
          {!transferComplete ? (
            <Button
              onClick={handleTransferAllFunds}
              disabled={isTransferring || currentUtxos.length === 0}
              className="flex-1"
            >
              {isTransferring ? (
                <>
                  <Loader className="h-4 w-4 animate-spin mr-2" />
                  Transferring...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Transfer All Funds
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={onContinue}
              className="flex-1"
            >
              Complete Migration
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}
        </div>
      </CardUI>
    </div>
  );
}
