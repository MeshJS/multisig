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
import React from "react";
import useUser from "@/hooks/useUser";
import { useUserStore } from "@/lib/zustand/user";
import { getProvider } from "@/utils/get-provider";
import { Asset } from "@meshsdk/core";
import useUTXOS from "@/hooks/useUTXOS";
import { api } from "@/utils/api";
import { useNostrChat } from "@jinglescode/nostr-chat-plugin";

export default function ConnectWallet() {
  const setNetwork = useSiteStore((state) => state.setNetwork);
  const pastWallet = useUserStore((state) => state.pastWallet);
  const setPastWallet = useUserStore((state) => state.setPastWallet);
  const pastUtxosEnabled = useUserStore((state) => state.pastUtxosEnabled);
  const setPastUtxosEnabled = useUserStore((state) => state.setPastUtxosEnabled);
  const setUserAssets = useUserStore((state) => state.setUserAssets);
  const userAssets = useUserStore((state) => state.userAssets);
  const setUserAssetMetadata = useUserStore(
    (state) => state.setUserAssetMetadata,
  );
  const { user, isLoading: isUserLoading } = useUser();
  const { generateNsec } = useNostrChat();
  const userAddress = useUserStore((state) => state.userAddress);
  const setUserAddress = useUserStore((state) => state.setUserAddress);

  const wallets = useWalletList();
  const { connect, connected, wallet, name } = useWallet();
  const network = useSiteStore((state) => state.network);
  const {
    wallet: utxosWallet,
    isEnabled: isUtxosEnabled,
    isLoading: isUtxosLoading,
    error: utxosError,
    enable: enableUtxos,
    disable: disableUtxos,
  } = useUTXOS();

  const { mutate: createUser } = api.user.createUser.useMutation({
    onError: (e) => console.error(e),
  });

  async function connectWallet(walletId: string) {
    setPastWallet(walletId);
    await connect(walletId);
  }

  /**
   * Try to connect the wallet when the user loads the application, if user had connected before,
   */
  useEffect(() => {
    async function handleAutoWalletConnect() {
      if (pastWallet && !connected) {
        try {
          await connect(pastWallet);
        } catch (e) {
          console.error("[AutoConnect] Failed to auto-connect wallet:", e);
          setPastWallet(undefined);
        }
      }
    }
    handleAutoWalletConnect();
  }, [pastWallet, connected, connect, setPastWallet]);
  
  /**
   * Try to auto-enable UTXOS wallet when the user loads the application, if it was enabled before
   * Use a ref to prevent infinite loops from repeated attempts
   */
  const autoEnableAttemptedRef = useRef(false);
  
  useEffect(() => {
    async function handleAutoUtxosEnable() {
      // Prevent multiple attempts in the same session
      if (autoEnableAttemptedRef.current) {
        return;
      }
      
      if (pastUtxosEnabled && !isUtxosEnabled && !isUtxosLoading) {
        autoEnableAttemptedRef.current = true; // Mark as attempted
        
        try {
          await enableUtxos();
        } catch (e) {
          console.error("[AutoConnect] Failed to auto-enable UTXOS wallet:", e);
          const errorMessage = e instanceof Error ? e.message : String(e);
          
          // Check if it's a "Refused" error (user denied or wallet disconnected)
          if (errorMessage.includes("Refused") || errorMessage.includes("refused")) {
            setPastUtxosEnabled(false);
          } else {
            // For other errors, also clear to prevent infinite retries
            setPastUtxosEnabled(false);
          }
        }
      } else if (pastUtxosEnabled && isUtxosEnabled) {
        autoEnableAttemptedRef.current = true; // Mark as attempted since already enabled
      } else if (!pastUtxosEnabled && !isUtxosEnabled) {
        autoEnableAttemptedRef.current = true; // Mark as attempted since nothing to do
      }
    }
    handleAutoUtxosEnable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastUtxosEnabled, isUtxosEnabled, isUtxosLoading, setPastUtxosEnabled]);

  useEffect(() => {
    let isMounted = true;
    let timeoutId: NodeJS.Timeout | null = null;
    let retryTimeoutId: NodeJS.Timeout | null = null;

    async function lookupWalletAssets() {
      if (!wallet || !isMounted) return;
      try {
        const assets = await wallet.getBalance();
        if (!isMounted) return;
        
        const provider = getProvider(await wallet.getNetworkId());
        const userAssets: Asset[] = [];
        if (assets) {
          for (const asset of assets) {
            userAssets.push({
              unit: asset.unit,
              quantity: asset.quantity,
            });
            if (asset.unit === "lovelace") continue;
            try {
              const assetInfo = await provider.get(`/assets/${asset.unit}`);
              if (isMounted) {
                setUserAssetMetadata(
                  asset.unit,
                  assetInfo?.metadata?.name ||
                    assetInfo?.onchain_metadata?.name ||
                    asset.unit,
                  assetInfo?.metadata?.decimals || 0,
                );
              }
            } catch (assetError) {
              // Skip individual asset metadata errors to avoid blocking
              console.warn(`Failed to fetch metadata for asset ${asset.unit}:`, assetError);
            }
          }
          if (isMounted) {
            setUserAssets(userAssets);
          }
        }
      } catch (error) {
        if (!isMounted) return;
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Handle rate limiting errors gracefully
        if (errorMessage.includes("too many requests") || errorMessage.includes("429")) {
          console.warn("Rate limit reached, will retry later");
          // Retry after a delay if rate limited
          if (retryTimeoutId) clearTimeout(retryTimeoutId);
          retryTimeoutId = setTimeout(() => {
            if (isMounted && wallet && connected) {
              lookupWalletAssets();
            }
          }, 5000); // Retry after 5 seconds
        } else {
          console.error("Error looking up wallet assets:", error);
        }
      }
    }
    async function handleNetworkChange() {
      if (connected && wallet && isMounted) {
        try {
          const networkId = await wallet.getNetworkId();
          if (isMounted) {
            setNetwork(networkId);
          }
        } catch (error) {
          console.error("Error getting network ID:", error);
        }
      }
    }
    async function getWalletAssets() {
      if (wallet && connected && isMounted) {
        // Skip if assets are already loaded to avoid unnecessary calls
        if (userAssets && userAssets.length > 0) {
          return;
        }
        // Add a small delay to prevent rapid successive calls
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          if (isMounted) {
            lookupWalletAssets();
          }
        }, 500);
      }
    }
    handleNetworkChange();
    getWalletAssets();

    return () => {
      isMounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (retryTimeoutId) {
        clearTimeout(retryTimeoutId);
      }
    };
  }, [connected, wallet, setNetwork, userAssets]);

  // Handle UTXOS wallet connection - same as normal wallet
  const utxosInitializedRef = useRef(false);
  
  useEffect(() => {
    (async () => {
      if (!isUtxosEnabled || !utxosWallet) {
        utxosInitializedRef.current = false;
        return;
      }

      // Prevent re-initialization if already initialized
      if (utxosInitializedRef.current) {
        return;
      }

      try {
        // 1) Set user address in store (same as normal wallet)
        let address = (await utxosWallet.cardano.getUsedAddresses())[0];
        if (!address) {
          address = (await utxosWallet.cardano.getUnusedAddresses())[0];
        }

        if (!address) {
          console.error("[UTXOS] No address found from wallet");
          return;
        }

        setUserAddress(address);

        // 2) Get stake address
        const stakeAddresses = await utxosWallet.cardano.getRewardAddresses();
        const stakeAddress = stakeAddresses[0];

        if (!stakeAddress || !address) {
          console.error("[UTXOS] No stake address or payment address found");
          return;
        }

        // 3) Get DRep key hash (optional)
        let drepKeyHash = "";
        try {
          if (typeof utxosWallet.cardano.getDRep === 'function') {
            const dRepKey = await utxosWallet.cardano.getDRep();
            if (dRepKey && typeof dRepKey === 'object' && 'publicKeyHash' in dRepKey) {
              drepKeyHash = dRepKey.publicKeyHash as string;
            }
          }
        } catch (error) {
          // DRep key is optional, ignore errors
        }

        // 4) Create or update user (same as normal wallet)
        if (!isUserLoading) {
          const nostrKey = generateNsec();
          createUser({
            address,
            stakeAddress,
            drepKeyHash,
            nostrKey: JSON.stringify(nostrKey),
          });
        }

        utxosInitializedRef.current = true;
      } catch (error) {
        console.error("[UTXOS] Error in wallet initialization:", error);
        utxosInitializedRef.current = false;
      }
    })();
  }, [isUtxosEnabled, utxosWallet, isUserLoading, createUser, generateNsec, setUserAddress]);

  // Handle UTXOS wallet assets and network
  useEffect(() => {
    let isMounted = true;
    let timeoutId: NodeJS.Timeout | null = null;
    let retryTimeoutId: NodeJS.Timeout | null = null;
    let retryCount = 0;
    const MAX_RETRIES = 3;

    async function lookupUtxosWalletAssets() {
      if (!utxosWallet || !isUtxosEnabled || !isMounted) return;
      try {
        const balance = await utxosWallet.cardano.getBalance();
        if (!isMounted) return;
        
        retryCount = 0; // Reset retry count on success
        
        const provider = getProvider(network);
        const userAssets: Asset[] = [];
        if (balance) {
          for (const asset of balance) {
            userAssets.push({
              unit: asset.unit,
              quantity: asset.quantity,
            });
            if (asset.unit === "lovelace") continue;
            try {
              const assetInfo = await provider.get(`/assets/${asset.unit}`);
              if (isMounted) {
                setUserAssetMetadata(
                  asset.unit,
                  assetInfo?.metadata?.name ||
                    assetInfo?.onchain_metadata?.name ||
                    asset.unit,
                  assetInfo?.metadata?.decimals || 0,
                );
              }
            } catch (assetError) {
              // Skip individual asset metadata errors to avoid blocking
              console.warn(`[UTXOS] Failed to fetch metadata for asset ${asset.unit}:`, assetError);
            }
          }
          if (isMounted) {
            setUserAssets(userAssets);
          }
        }
      } catch (error) {
        if (!isMounted) return;
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Handle rate limiting errors gracefully with exponential backoff
        if (errorMessage.includes("too many requests") || errorMessage.includes("429")) {
          if (retryCount < MAX_RETRIES) {
            retryCount++;
            const backoffDelay = Math.min(5000 * Math.pow(2, retryCount - 1), 30000); // Exponential backoff, max 30s
            console.warn(`[UTXOS] Rate limit reached, retrying in ${backoffDelay}ms (attempt ${retryCount}/${MAX_RETRIES})`);
            if (retryTimeoutId) clearTimeout(retryTimeoutId);
            retryTimeoutId = setTimeout(() => {
              if (isMounted && utxosWallet && isUtxosEnabled) {
                lookupUtxosWalletAssets();
              }
            }, backoffDelay);
          } else {
            console.error("[UTXOS] Max retries reached for asset lookup due to rate limiting");
          }
        } else {
          console.error("[UTXOS] Error looking up wallet assets:", error);
        }
      }
    }
    async function getUtxosWalletAssets() {
      if (utxosWallet && isUtxosEnabled && isMounted) {
        // Skip if assets are already loaded to avoid unnecessary calls
        if (userAssets && userAssets.length > 0) {
          return;
        }
        // Add a small delay to prevent rapid successive calls
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          if (isMounted) {
            lookupUtxosWalletAssets();
          }
        }, 500);
      }
    }
    getUtxosWalletAssets();

    return () => {
      isMounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (retryTimeoutId) {
        clearTimeout(retryTimeoutId);
      }
    };
  }, [isUtxosEnabled, utxosWallet, network, setUserAssets, setUserAssetMetadata, userAssets]);

        const handleUtxosEnable = async () => {
          try {
            await enableUtxos();
          } catch (error) {
            console.error("[UTXOS] Failed to enable wallet:", error);
          }
        };
  
  // Update persistence flag when UTXOS wallet state changes
  // Use a ref to track the last synced state to prevent infinite loops
  const lastSyncedStateRef = useRef<{ enabled: boolean; hasWallet: boolean } | null>(null);
  
  useEffect(() => {
    const currentState = { enabled: isUtxosEnabled, hasWallet: !!utxosWallet };
    const lastState = lastSyncedStateRef.current;
    
    // Only update if state actually changed
    if (lastState && 
        lastState.enabled === currentState.enabled && 
        lastState.hasWallet === currentState.hasWallet) {
      return; // State hasn't changed, skip update
    }
    
    // Update the ref first to prevent re-triggering
    lastSyncedStateRef.current = currentState;
    
    if (isUtxosEnabled && utxosWallet) {
      // Only set if it's not already set to prevent unnecessary updates
      // Use functional update to avoid dependency on pastUtxosEnabled
      setPastUtxosEnabled((prev) => {
        if (!prev) {
          console.log("[UTXOS] Wallet enabled, setting pastUtxosEnabled to true");
          return true;
        }
        return prev;
      });
    } else if (!isUtxosEnabled) {
      // Only clear if it was previously enabled (don't clear on initial load)
      // Use functional update to avoid dependency on pastUtxosEnabled
      setPastUtxosEnabled((prev) => {
        if (prev) {
          console.log("[UTXOS] Wallet disabled, clearing pastUtxosEnabled");
          return false;
        }
        return prev;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUtxosEnabled, utxosWallet, setPastUtxosEnabled]);
  
  // Handle manual disable with cleanup
  const handleUtxosDisable = async () => {
    try {
      console.log("[UTXOS] Manual disable triggered");
      await disableUtxos();
      setPastUtxosEnabled(false);
      // Clear user assets and address on disconnect
      setUserAssets([]);
      setUserAddress(undefined);
      // Reset initialization flag
      utxosInitializedRef.current = false;
      console.log("[UTXOS] Manual disable successful");
    } catch (error) {
      console.error("[UTXOS] Failed to disable UTXOS wallet:", error);
    }
  };

  const isAnyWalletConnected = connected || isUtxosEnabled;
  const isConnecting = (connected && !user) || (isUtxosEnabled && !user) || isUtxosLoading;

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="rounded-full">
            <Wallet className="mr-2 h-5 w-5" />
            {isConnecting && "Connecting..."}
            {!isConnecting && !isAnyWalletConnected && "Connect"}
            {!isConnecting && isAnyWalletConnected && user && "Connected"}
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
      <Button
        variant="secondary"
        className="rounded-full"
        onClick={isUtxosEnabled ? handleUtxosDisable : handleUtxosEnable}
        disabled={isUtxosLoading}
      >
        <Wallet className="mr-2 h-5 w-5" />
        {isUtxosLoading
          ? "Connecting..."
          : isUtxosEnabled
            ? user
              ? "UTXOS"
              : "UTXOS Connected"
            : "UTXOS"}
      </Button>
    </div>
  );
}
