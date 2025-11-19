import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWallet, useWalletList, useNetwork, useAssets } from "@meshsdk/react";
import { useSiteStore } from "@/lib/zustand/site";
import { useEffect } from "react";
import useUser from "@/hooks/useUser";
import { useUserStore } from "@/lib/zustand/user";
import { getProvider } from "@/utils/get-provider";

export default function ConnectWallet() {
  const setNetwork = useSiteStore((state) => state.setNetwork);
  const pastWallet = useUserStore((state) => state.pastWallet);
  const setPastWallet = useUserStore((state) => state.setPastWallet);
  const setUserAssets = useUserStore((state) => state.setUserAssets);
  const setUserAssetMetadata = useUserStore(
    (state) => state.setUserAssetMetadata,
  );
  const { user, isLoading: userLoading } = useUser();

  const wallets = useWalletList();
  const { connect, connected, wallet, name } = useWallet();
  const networkId = useNetwork();
  const assets = useAssets();
  const network = useSiteStore((state) => state.network);

  async function connectWallet(walletId: string) {
    setPastWallet(walletId);
    await connect(walletId);
  }

  // Auto-connect if user had connected before
  useEffect(() => {
    if (pastWallet && !connected && wallets.length > 0) {
      const walletExists = wallets.some((w) => w.id === pastWallet);
      if (walletExists) {
        connect(pastWallet).catch(() => {
          setPastWallet(undefined);
        });
      } else {
        setPastWallet(undefined);
      }
    }
  }, [pastWallet, connected, wallets, connect, setPastWallet]);

  // Sync network from hook to store
  useEffect(() => {
    if (networkId !== undefined && networkId !== null) {
      setNetwork(networkId);
    }
  }, [networkId, setNetwork]);

  // Process assets and fetch metadata
  useEffect(() => {
    if (!connected || !assets || assets.length === 0 || networkId === undefined || networkId === null) return;

    async function processAssets() {
      if (!assets || networkId === undefined || networkId === null) return;
      
      try {
        const provider = getProvider(networkId);
        setUserAssets(assets);
        
        for (const asset of assets) {
          if (asset.unit === "lovelace") continue;
          try {
            const assetInfo = await provider.get(`/assets/${asset.unit}`);
            setUserAssetMetadata(
              asset.unit,
              assetInfo?.metadata?.name ||
                assetInfo?.onchain_metadata?.name ||
                asset.unit,
              assetInfo?.metadata?.decimals || 0,
            );
          } catch (error) {
            // Continue if asset metadata fetch fails
          }
        }
      } catch (error) {
        console.error("Error processing assets:", error);
      }
    }

    processAssets();
  }, [assets, connected, networkId, setUserAssets, setUserAssetMetadata]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" className="rounded-full">
          <Wallet className="mr-2 h-5 w-5" />
          {connected && (!user || userLoading) && "Connecting..."}
          {!connected && "Connect"}
          {connected && user && !userLoading && name}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Select Wallet</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {wallets.length === 0 ? (
          <DropdownMenuItem disabled>
            <span className="text-muted-foreground">
              No wallets available. Please install a Cardano wallet extension.
            </span>
          </DropdownMenuItem>
        ) : (
          wallets.map((wallet, i) => {
            return (
              <DropdownMenuItem key={i} onClick={() => connectWallet(wallet.id)}>
                {wallet.name}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
