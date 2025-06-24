import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { CheckCircle2, Copy } from "lucide-react";

import { api } from "@/utils/api";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "@/lib/zustand/user";
import { useSiteStore } from "@/lib/zustand/site";
import { buildWallet } from "@/hooks/common";

import PageHeader from "@/components/common/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import ProgressIndicator from "@/components/pages/homepage/wallets/new-wallet-flow/shared/ProgressIndicator";
import WalletFlowPageLayout from "@/components/pages/homepage/wallets/new-wallet-flow/shared/WalletFlowPageLayout";

export default function PageSuccessWallet() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const walletId = router.query.id as string;
  const userAddress = useUserStore((state) => state.userAddress);
  const network = useSiteStore((state) => state.network);

  // Get wallet data to show details
  const { data: walletData } = api.wallet.getWallet.useQuery(
    { walletId, address: userAddress || "" },
    { enabled: !!walletId && !!userAddress }
  );

  // Build wallet with address and other computed fields
  const wallet = walletData ? buildWallet(walletData, network) : null;


  const handleViewWallets = () => {
    setLoading(true);
    void router.push("/wallets");
  };

  const handleViewWallet = () => {
    setLoading(true);
    void router.push(`/wallets/${walletId}`);
  };

  const handleCopyAddress = () => {
    if (wallet?.address) {
      navigator.clipboard.writeText(wallet.address);
      toast({
        title: "Copied!",
        description: "Wallet address copied to clipboard",
        duration: 3000,
      });
    }
  };

  const handleCopyDRepId = () => {
    if (wallet?.dRepId) {
      navigator.clipboard.writeText(wallet.dRepId);
      toast({
        title: "Copied!",
        description: "DRep ID copied to clipboard",
        duration: 3000,
      });
    }
  };

  return (
    <WalletFlowPageLayout currentStep={3}>
      {/* Success Card */}
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Wallet created successfully</CardTitle>
        </CardHeader>
        
        <CardContent className="space-y-4 sm:space-y-6">
          {/* Success notification inline */}
          <div className="flex items-start gap-3 p-4 bg-muted/50 border border-muted-foreground/20 rounded-lg">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                Your multi-signature wallet is ready to use
              </p>
              <p className="text-sm text-muted-foreground">
                Send ADA to the wallet address to activate it on the blockchain.
              </p>
            </div>
          </div>
          
          {/* Wallet Details */}
          {wallet && (
            <div className="p-4 bg-muted/30 rounded-lg space-y-3">
              {/* Name */}
              <div className="grid grid-cols-[120px_1fr] gap-4 items-baseline">
                <span className="text-sm text-muted-foreground">Name</span>
                <span className="text-sm font-medium">{wallet.name}</span>
              </div>
              {/* Description - only if exists */}
              {wallet.description && (
                <div className="grid grid-cols-[120px_1fr] gap-4 items-baseline">
                  <span className="text-sm text-muted-foreground">Description</span>
                  <span className="text-sm">{wallet.description}</span>
                </div>
              )}
              {/* Signature Rule */}
              <div className="grid grid-cols-[120px_1fr] gap-4 items-baseline">
                <span className="text-sm text-muted-foreground">Signature Rule</span>
                <span className="text-sm">
                  {wallet.type === 'atLeast' ? `${wallet.numRequiredSigners} of ${wallet.signersAddresses.length} signers must approve` :
                   wallet.type === 'all' ? `All signers (of ${wallet.signersAddresses.length}) must approve` :
                   wallet.type === 'any' ? `Any signer (of ${wallet.signersAddresses.length}) can approve` :
                   `${wallet.numRequiredSigners} of ${wallet.signersAddresses.length} signers must approve`}
                </span>
              </div>
              {/* Wallet Address with Copy Button */}
              {wallet.address && (
                <div className="grid grid-cols-[120px_1fr_auto] gap-4 items-center">
                  <span className="text-sm text-muted-foreground">Address</span>
                  <span className="text-xs font-mono break-all">{wallet.address}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyAddress}
                    className="h-8 w-8 p-0"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              )}
              {/* DRep ID with Copy Button */}
              {wallet.dRepId && (
                <div className="grid grid-cols-[120px_1fr_auto] gap-4 items-center">
                  <span className="text-sm text-muted-foreground">DRep ID</span>
                  <span className="text-xs font-mono break-all">{wallet.dRepId}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyDRepId}
                    className="h-8 w-8 p-0"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              )}
              {/* Stake Credential - only if set */}
              {wallet.stakeCredentialHash && (
                <div className="grid grid-cols-[120px_1fr] gap-4 items-baseline">
                  <span className="text-sm text-muted-foreground">Stake Credential</span>
                  <span className="text-xs font-mono break-all">{wallet.stakeCredentialHash}</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action Section - Buttons aligned right */}
      <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row gap-3 sm:gap-4 sm:justify-end">
        <Button
          variant="outline"
          onClick={handleViewWallets}
          disabled={loading}
          className="w-full sm:w-auto order-2 sm:order-1"
          size="lg"
        >
          View All Wallets
        </Button>
        <Button
          onClick={handleViewWallet}
          disabled={loading}
          className="w-full sm:w-auto order-1 sm:order-2"
          size="lg"
        >
          Go to Wallet
        </Button>
      </div>
    </WalletFlowPageLayout>
  );
}