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
import { useWallet, useWalletList } from "@meshsdk/react";
import { useSiteStore } from "@/lib/zustand/site";
import { useEffect, useRef } from "react";
import useUser from "@/hooks/useUser";
import { useUserStore } from "@/lib/zustand/user";
import { getProvider } from "@/utils/get-provider";
import { Asset } from "@meshsdk/core";

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
  const network = useSiteStore((state) => state.network);
  const connectingRef = useRef(false);
  const fetchingAssetsRef = useRef(false);
  const lastWalletIdRef = useRef<string | null>(null);
  const fetchingNetworkRef = useRef(false);
  const lastNetworkWalletRef = useRef<string | null>(null);
  const userAssets = useUserStore((state) => state.userAssets);

  async function connectWallet(walletId: string) {
    setPastWallet(walletId);
    await connect(walletId);
  }

  /**
   * Try to connect the wallet when the user loads the application, if user had connected before,
   * but only if:
   * 1. The wallet list has been loaded (wallets.length > 0)
   * 2. The pastWallet exists in the available wallets
   * 3. We're not already connected
   * 4. We're not already attempting to connect
   */
  useEffect(() => {
    async function handleAutoWalletConnect() {
      // Don't attempt if already connected or already connecting
      if (connected || connectingRef.current) {
        return;
      }

      // Don't attempt if no pastWallet is stored
      if (!pastWallet) {
        return;
      }

      // Wait for wallet list to be available
      // If wallets array is empty, wallets might still be loading
      // The effect will re-run when wallets become available
      if (wallets.length === 0) {
        return;
      }

      // Check if the pastWallet exists in the available wallets
      const walletExists = wallets.some((w) => w.id === pastWallet);
      if (!walletExists) {
        console.warn(
          `Stored wallet "${pastWallet}" not found in available wallets. Clearing stored wallet.`,
        );
        setPastWallet(undefined);
        return;
      }

      // Attempt to connect
      connectingRef.current = true;
      try {
        console.log(`Attempting to auto-connect wallet: ${pastWallet}`);
        await connect(pastWallet);
        console.log(`Successfully auto-connected wallet: ${pastWallet}`);
      } catch (e) {
        console.error(
          `Failed to auto-connect wallet "${pastWallet}":`,
          e instanceof Error ? e.message : e,
        );
        setPastWallet(undefined);
      } finally {
        connectingRef.current = false;
      }
    }

    handleAutoWalletConnect();
  }, [pastWallet, connected, wallets, connect, setPastWallet]);

  useEffect(() => {
    async function lookupWalletAssets() {
      if (!wallet) return;
      
      // Prevent multiple simultaneous calls
      if (fetchingAssetsRef.current) {
        console.log("Assets fetch already in progress, skipping...");
        return;
      }

      // Use wallet name as identifier (doesn't require API call)
      const walletId = name || "unknown";

      // Skip if we've already fetched for this wallet and have assets
      if (lastWalletIdRef.current === walletId && userAssets.length > 0) {
        console.log("Assets already loaded for this wallet, skipping fetch");
        return;
      }

      fetchingAssetsRef.current = true;
      lastWalletIdRef.current = walletId;

      try {
        console.log("Fetching wallet balance...");
        const assets = await wallet.getBalance();
        // Use network from store if available, otherwise fetch it
        let networkId = network;
        if (!networkId) {
          try {
            networkId = await wallet.getNetworkId();
            setNetwork(networkId);
          } catch (networkError) {
            console.error("Error getting network ID for provider:", networkError);
            // Use default network if we can't get it
            networkId = 0; // Mainnet default
          }
        }
        const provider = getProvider(networkId);
        const fetchedAssets: Asset[] = [];
        if (assets) {
          for (const asset of assets) {
            fetchedAssets.push({
              unit: asset.unit,
              quantity: asset.quantity,
            });
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
            } catch (assetError) {
              // If asset metadata fetch fails, continue with other assets
              console.warn(`Failed to fetch metadata for asset ${asset.unit}:`, assetError);
            }
          }
          setUserAssets(fetchedAssets);
          console.log("Successfully fetched wallet assets");
        }
        // Reset the fetching flag after successful fetch
        fetchingAssetsRef.current = false;
      } catch (error) {
        console.error("Error looking up wallet assets:", error);
        // If it's a rate limit error, don't clear the ref immediately
        // to prevent rapid retries - wait 5 seconds before allowing retry
        if (error instanceof Error && error.message.includes("too many requests")) {
          console.warn("Rate limit hit, will retry after delay");
          setTimeout(() => {
            fetchingAssetsRef.current = false;
          }, 5000);
          return;
        }
        // For other errors, reset immediately so we can retry
        fetchingAssetsRef.current = false;
      }
    }

    async function handleNetworkChange() {
      if (!connected || !wallet) return;
      
      // Prevent multiple simultaneous network ID fetches
      if (fetchingNetworkRef.current) {
        console.log("Network ID fetch already in progress, skipping...");
        return;
      }

      // Use wallet name as identifier (doesn't require API call)
      const walletId = name || "unknown";

      // Skip if we've already fetched network for this wallet
      if (lastNetworkWalletRef.current === walletId && network !== undefined) {
        console.log("Network ID already fetched for this wallet, skipping");
        return;
      }

      fetchingNetworkRef.current = true;
      lastNetworkWalletRef.current = walletId;

      try {
        console.log("Fetching network ID...");
        const networkId = await wallet.getNetworkId();
        setNetwork(networkId);
        console.log("Successfully fetched network ID:", networkId);
        fetchingNetworkRef.current = false;
      } catch (error) {
        console.error("Error getting network ID:", error);
        // If rate limited, wait before retry
        if (error instanceof Error && error.message.includes("too many requests")) {
          console.warn("Rate limit hit for network ID, will retry after delay");
          setTimeout(() => {
            fetchingNetworkRef.current = false;
          }, 5000);
          return;
        }
        fetchingNetworkRef.current = false;
      }
    }

    async function getWalletAssets() {
      if (wallet && connected) {
        await lookupWalletAssets();
      }
    }

    // Only run if wallet and connected state are available
    if (wallet && connected) {
      handleNetworkChange();
      getWalletAssets();
    }
  }, [connected, wallet, name, setNetwork, setUserAssets, setUserAssetMetadata]);

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
        {wallets.map((wallet, i) => {
          return (
            <DropdownMenuItem key={i} onClick={() => connectWallet(wallet.id)}>
              {wallet.name}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
