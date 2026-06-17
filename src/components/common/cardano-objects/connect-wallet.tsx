import { Wallet, Loader2, CheckCircle2, AlertCircle, ShieldCheck, Sparkles, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWalletList, useNetwork, useAssets } from "@meshsdk/react";
import { useSiteStore } from "@/lib/zustand/site";
import { useEffect, useRef, useState, useCallback } from "react";
import React from "react";
import useUser from "@/hooks/useUser";
import { useUserStore } from "@/lib/zustand/user";
import { getProvider } from "@/utils/get-provider";
import { Asset } from "@meshsdk/core";
import { normalizeAddressToBech32 } from "@/utils/addressCompatibility";
import useUTXOS from "@/hooks/useUTXOS";
import { api } from "@/utils/api";
import { useWalletContext, WalletState } from "@/hooks/useWalletContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useWalletDetection } from "@/hooks/useWalletDetection";

// Main component - uses walletDetectionKey to force remount of useWalletList
export default function ConnectWallet() {
  // Force re-mount key for useWalletList when wallets are detected
  const [walletDetectionKey, setWalletDetectionKey] = useState(0);
  const hasTriggeredRemountRef = useRef(false);
  const remountTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Use wallet detection hook to monitor window.cardano
  useWalletDetection({
    onWalletsDetected: (count) => {
      // Only trigger remount once
      if (!hasTriggeredRemountRef.current && count > 0) {
        hasTriggeredRemountRef.current = true;
        
        // Clear any existing timeout
        if (remountTimeoutRef.current) {
          clearTimeout(remountTimeoutRef.current);
        }
        
        // Delay to give MeshJS time to process wallets, but only remount once
        remountTimeoutRef.current = setTimeout(() => {
          setWalletDetectionKey((prev) => prev + 1);
          remountTimeoutRef.current = null;
        }, 300);
      }
    },
    pollingInterval: 100,
    maxPollingTime: 10000,
  });

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (remountTimeoutRef.current) {
        clearTimeout(remountTimeoutRef.current);
      }
    };
  }, []);

  return <ConnectWalletInner key={walletDetectionKey} />;
}

// Internal component that uses useWalletList - will remount when key changes
function ConnectWalletInner() {
  const wallets = useWalletList();
  const networkId = useNetwork();
  const assets = useAssets();
  
  
  return <ConnectWalletContent wallets={wallets} networkId={networkId} assets={assets} />;
}

// Main component content
function ConnectWalletContent({
  wallets,
  networkId,
  assets,
}: {
  wallets: ReturnType<typeof useWalletList>;
  networkId: ReturnType<typeof useNetwork>;
  assets: ReturnType<typeof useAssets>;
}) {
  const setNetwork = useSiteStore((state) => state.setNetwork);
  const pastUtxosEnabled = useUserStore((state) => state.pastUtxosEnabled);
  const setPastUtxosEnabled = useUserStore((state) => state.setPastUtxosEnabled);
  const setUserAssets = useUserStore((state) => state.setUserAssets);
  const userAssets = useUserStore((state) => state.userAssets);
  const setUserAssetMetadata = useUserStore(
    (state) => state.setUserAssetMetadata,
  );
  const { user, isLoading: isUserLoading } = useUser();
  const userAddress = useUserStore((state) => state.userAddress);
  const setUserAddress = useUserStore((state) => state.setUserAddress);
  const requestReauth = useUserStore((state) => state.requestReauth);
  const { toast } = useToast();

  // Use WalletContext for regular wallet connection
  const {
    state,
    connectingWallet,
    connectedWalletName,
    connectWallet: connectWalletContext,
    disconnect,
    setPersist,
    error,
  } = useWalletContext();

  // UTXOS wallet hook
  const {
    wallet: utxosWallet,
    isEnabled: isUtxosEnabled,
    isLoading: isUtxosLoading,
    error: utxosError,
    enable: enableUtxos,
    disable: disableUtxos,
  } = useUTXOS();

  // Get utils for cache invalidation
  const ctx = api.useUtils();
  
  const { mutate: createUser } = api.user.createUser.useMutation({
    onSuccess: (_, variables) => {
      // Invalidate user query to refresh logged-in state
      void ctx.user.getUserByAddress.invalidate({ address: variables.address });
    },
    onError: (e) => console.error(e),
  });

  // Track wallet detection state
  const [detectingWallets, setDetectingWallets] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  // When no wallet extension is detected we lead with the UTXOS CTA; this lets
  // a user opt into the full wallet picker anyway.
  const [forceMenu, setForceMenu] = useState(false);
  const walletsRef = useRef(wallets);
  const hasInitializedPersist = useRef(false);
  const hasAttemptedAutoConnect = useRef(false);
  
  const network = useSiteStore((state) => state.network);
  const netId = (network === 1 ? 1 : 0) as 0 | 1;
  const connected = String(state) === String(WalletState.CONNECTED);

  // Check if any Sheet/Dialog is open to prevent dropdown from opening
  const checkIfSheetOpen = useCallback(() => {
    if (typeof window === "undefined") return false;
    const sheets = document.querySelectorAll('[data-radix-dialog-content], [data-radix-sheet-content]');
    return Array.from(sheets).some(
      (sheet) => sheet.getAttribute('data-state') === 'open'
    );
  }, []);

  // Close dropdown when a Sheet/Dialog opens to prevent aria-hidden conflicts
  useEffect(() => {
    if (!dropdownOpen) return;

    const checkForOpenSheets = () => {
      if (checkIfSheetOpen()) {
        setDropdownOpen(false);
      }
    };

    // Check periodically when dropdown is open
    const interval = setInterval(checkForOpenSheets, 100);
    return () => clearInterval(interval);
  }, [dropdownOpen, checkIfSheetOpen]);

  // Prevent dropdown from opening if Sheet is already open
  const handleDropdownOpenChange = useCallback((open: boolean) => {
    if (open && checkIfSheetOpen()) {
      return; // Don't open if Sheet is open
    }
    setDropdownOpen(open);
  }, [checkIfSheetOpen]);

  // Keep wallets ref in sync
  useEffect(() => {
    walletsRef.current = wallets;
    if (wallets.length > 0) {
      setDetectingWallets(false);
    }
  }, [wallets]);

  // Initialize MeshJS persistence on mount
  useEffect(() => {
    if (!hasInitializedPersist.current) {
      setPersist(true);
      hasInitializedPersist.current = true;
    }
  }, [setPersist]);

  // Update detectingWallets state based on wallet detection
  useEffect(() => {
    if (wallets.length > 0) {
      setDetectingWallets(false);
    } else {
      // Check window.cardano directly to see if wallets are available but not yet detected by useWalletList
      if (typeof window !== "undefined") {
        const cardano = (window as any).cardano || {};
        const walletKeys = Object.keys(cardano);
        if (walletKeys.length > 0) {
          setDetectingWallets(true);
        } else {
          setDetectingWallets(false);
        }
      }
    }
  }, [wallets.length]);

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
  }, [pastUtxosEnabled, isUtxosEnabled, isUtxosLoading, setPastUtxosEnabled, enableUtxos]);

  // Auto-connect using MeshJS persistence  
  useEffect(() => {
    if (
      String(state) === String(WalletState.NOT_CONNECTED) &&
      wallets.length > 0 &&
      !connectingWallet &&
      !hasAttemptedAutoConnect.current
    ) {
      // Check MeshJS localStorage persistence
      const persisted = localStorage.getItem("mesh-wallet-persist");

      if (persisted) {
        hasAttemptedAutoConnect.current = true;
        try {
          const { walletName } = JSON.parse(persisted);
          const walletExists = wallets.some((w) => w.id === walletName);
          
          if (walletExists) {
            connectWalletContext(walletName, true).catch(() => {
              // Clear invalid persistence
              localStorage.removeItem("mesh-wallet-persist");
              hasAttemptedAutoConnect.current = false;
            });
          } else {
            // Clear invalid persistence
            localStorage.removeItem("mesh-wallet-persist");
            hasAttemptedAutoConnect.current = false;
          }
        } catch {
          // Clear corrupted persistence
          localStorage.removeItem("mesh-wallet-persist");
          hasAttemptedAutoConnect.current = false;
        }
      }
    }
    
    // Reset auto-connect flag when disconnected
    if (String(state) === String(WalletState.NOT_CONNECTED) && !connectingWallet) {
      hasAttemptedAutoConnect.current = false;
    }
  }, [state, wallets, connectingWallet, connectWalletContext]);

  // Handle connection errors with toast notifications
  useEffect(() => {
    if (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "string"
          ? error
          : "Failed to connect wallet";
      
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: errorMessage,
      });
    }
  }, [error, toast]);

  // Sync network from hook to store
  useEffect(() => {
    if (networkId !== undefined && networkId !== null) {
      setNetwork(networkId);
    }
  }, [networkId, setNetwork]);

  // Process assets and fetch metadata (for regular wallets via WalletContext)
  useEffect(() => {
    if (
      String(state) !== String(WalletState.CONNECTED) ||
      !assets ||
      assets.length === 0 ||
      networkId === undefined ||
      networkId === null
    )
      return;

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
      } catch {
        // Continue if asset processing fails
      }
    }

    processAssets();
  }, [
    assets,
    state,
    networkId,
    setUserAssets,
    setUserAssetMetadata,
  ]);

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
        let address: string | undefined;
        try {
          address = await utxosWallet.cardano.getChangeAddress();
        } catch {
          // ignore and fall back to used/unused addresses
        }
        if (!address) {
          address = (await utxosWallet.cardano.getUsedAddresses())[0];
        }
        if (!address) {
          address = (await utxosWallet.cardano.getUnusedAddresses())[0];
        }

        if (!address) {
          console.error("[UTXOS] No address found from wallet");
          return;
        }

        // Normalize possible hex-encoded CIP-30 address bytes to bech32 (addr/addr_test)
        address = normalizeAddressToBech32(address);

        setUserAddress(address);

        // 2) Get stake address
        const stakeAddresses = await utxosWallet.cardano.getRewardAddresses();
        let stakeAddress = stakeAddresses[0];

        // Normalize possible hex-encoded reward address bytes to bech32 (stake/stake_test)
        if (stakeAddress) {
          stakeAddress = normalizeAddressToBech32(stakeAddress);
        }

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
          createUser({
            address,
            stakeAddress,
            drepKeyHash,
          });
        }

        utxosInitializedRef.current = true;
      } catch (error) {
        console.error("[UTXOS] Error in wallet initialization:", error);
        utxosInitializedRef.current = false;
      }
    })();
  }, [isUtxosEnabled, utxosWallet, isUserLoading, createUser, setUserAddress]);

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
  const lastSyncedStateRef = useRef<{ enabled: boolean; hasWallet: boolean } | null>(null);
  
  useEffect(() => {
    const currentState = { enabled: isUtxosEnabled, hasWallet: !!utxosWallet };
    const lastState = lastSyncedStateRef.current;
    
    if (lastState && 
        lastState.enabled === currentState.enabled && 
        lastState.hasWallet === currentState.hasWallet) {
      return;
    }
    
    lastSyncedStateRef.current = currentState;
    
    if (isUtxosEnabled && utxosWallet) {
      setPastUtxosEnabled((prev) => {
        if (!prev) {
          console.log("[UTXOS] Wallet enabled, setting pastUtxosEnabled to true");
          return true;
        }
        return prev;
      });
    } else if (!isUtxosEnabled) {
      setPastUtxosEnabled((prev) => {
        if (prev) {
          console.log("[UTXOS] Wallet disabled, clearing pastUtxosEnabled");
          return false;
        }
        return prev;
      });
    }
  }, [isUtxosEnabled, utxosWallet, setPastUtxosEnabled]);
  
  const handleUtxosDisable = async () => {
    try {
      console.log("[UTXOS] Manual disable triggered");
      await disableUtxos();
      setPastUtxosEnabled(false);
      setUserAssets([]);
      setUserAddress(undefined);
      utxosInitializedRef.current = false;
      console.log("[UTXOS] Manual disable successful");
    } catch (error) {
      console.error("[UTXOS] Failed to disable UTXOS wallet:", error);
    }
  };

  async function handleConnectWallet(walletId: string) {
    try {
      await connectWalletContext(walletId, true);
      toast({
        title: "Wallet Connected",
        description: `Successfully connected to ${wallets.find((w) => w.id === walletId)?.name || walletId}`,
      });
    } catch {
      // Error handling is done via error state useEffect
    }
  }

  async function handleDisconnect() {
    disconnect();
    toast({
      title: "Wallet Disconnected",
      description: "You have been disconnected from your wallet",
    });
  }

  // Determine button state and content
  const isConnected = String(state) === String(WalletState.CONNECTED);
  const isConnecting =
    String(state) === String(WalletState.CONNECTING) || connectingWallet || isUtxosLoading;
  const isLoading = isConnecting || (isConnected && (!user || isUserLoading)) || (isUtxosEnabled && (!user || isUserLoading));
  const isAnyWalletConnected = isConnected || isUtxosEnabled;

  // Get button text and icon
  const getButtonContent = () => {
    if (isConnecting) {
      return (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin transition-opacity duration-300" />
          <span className="font-medium transition-opacity duration-300">Connecting...</span>
        </>
      );
    }
    if (isUtxosEnabled && isLoading) {
      return (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin transition-opacity duration-300" />
          <span className="font-medium transition-opacity duration-300">Loading...</span>
        </>
      );
    }
    if (isUtxosEnabled) {
      return (
        <>
          <CheckCircle2 className="mr-2 h-4 w-4 transition-all duration-300" />
          <span className="font-medium transition-opacity duration-300">
            {user && !isUserLoading ? "UTXOS" : "UTXOS Connected"}
          </span>
        </>
      );
    }
    // Connected but the user query resolved with no user → no wallet session
    // was established (authorization failed/cancelled). Don't spin forever:
    // show an actionable "Authorize" label; the dropdown offers re-authorize.
    if (isConnected && !user && !isUserLoading && !isConnecting) {
      return (
        <>
          <ShieldCheck className="mr-2 h-4 w-4 transition-all duration-300" />
          <span className="font-medium transition-opacity duration-300">Authorize</span>
        </>
      );
    }
    if (isConnected && isLoading) {
      return (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin transition-opacity duration-300" />
          <span className="font-medium transition-opacity duration-300">Loading...</span>
        </>
      );
    }
    if (isConnected && user && !isUserLoading) {
      return (
        <>
          <CheckCircle2 className="mr-2 h-4 w-4 transition-all duration-300" />
          <span className="font-medium transition-opacity duration-300">{connectedWalletName || "Connected"}</span>
        </>
      );
    }
    return (
      <>
        <Wallet className="mr-2 h-4 w-4 transition-all duration-300" />
        <span className="font-medium transition-opacity duration-300">Connect Wallet</span>
      </>
    );
  };

  // No Cardano wallet extension installed (detection has settled) and nothing
  // connected yet: lead non-crypto users straight to UTXOS instead of a picker.
  const noWalletDetected =
    !forceMenu &&
    !detectingWallets &&
    wallets.length === 0 &&
    !isAnyWalletConnected;

  if (noWalletDetected) {
    return (
      <div className="flex flex-col items-center gap-2">
        <Button
          size="lg"
          onClick={() => void handleUtxosEnable()}
          disabled={isUtxosLoading}
          className="gap-2"
        >
          {isUtxosLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Connecting…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Get Started with Multisig using UTXOS
            </>
          )}
        </Button>
        <button
          type="button"
          onClick={() => setForceMenu(true)}
          className="text-xs text-zinc-500 underline-offset-2 transition-colors hover:text-zinc-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Have a Cardano wallet? Connect it
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu open={dropdownOpen} onOpenChange={handleDropdownOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            className={cn(
              "rounded-full px-4 py-2 h-auto",
              "transition-all duration-300 ease-in-out",
              "shadow-sm hover:shadow-md",
              "border border-zinc-200 dark:border-zinc-800",
              "bg-white dark:bg-zinc-900",
              "hover:bg-zinc-50 dark:hover:bg-zinc-800",
              "text-zinc-900 dark:text-zinc-50",
              isConnecting && [
                "opacity-75 cursor-wait",
              ],
              "focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 dark:focus-visible:ring-zinc-600"
            )}
            disabled={isConnecting}
            aria-label={
              isConnected
                ? `Connected to ${connectedWalletName || "wallet"}`
                : isUtxosEnabled
                  ? "Connected to UTXOS"
                : "Connect wallet"
            }
          >
            {getButtonContent()}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="center"
          side="top"
          className={cn(
            // Mobile-first: make it feel centered in viewport
            "w-[calc(100vw-2rem)] max-w-[360px] sm:min-w-[280px] sm:max-w-[320px]",
            // Never overflow the viewport; scroll inside instead
            "max-h-[min(75vh,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto overscroll-contain",
            "rounded-lg border border-zinc-200 dark:border-zinc-800",
            "bg-white dark:bg-zinc-950",
            "shadow-xl backdrop-blur-sm",
            "p-2"
          )}
          sideOffset={8}
          collisionPadding={16}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
          }}
        >
          <DropdownMenuLabel className="flex items-center justify-between px-3 py-2 mb-1">
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Select Wallet
            </span>
            {detectingWallets && (
              <div className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Detecting...
                </span>
              </div>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="my-2" />
          
          {isConnected && (
            <>
              {!user && !isUserLoading && (
                <DropdownMenuItem
                  onClick={() => requestReauth()}
                  className={cn(
                    "px-3 py-2.5 rounded-md",
                    "text-zinc-900 dark:text-zinc-50",
                    "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                    "focus:bg-zinc-100 dark:focus:bg-zinc-800",
                    "transition-colors duration-150",
                    "cursor-pointer"
                  )}
                >
                  <ShieldCheck className="mr-2.5 h-4 w-4" />
                  <span className="font-medium">Authorize wallet</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={handleDisconnect}
                className={cn(
                  "px-3 py-2.5 rounded-md",
                  "text-zinc-900 dark:text-zinc-50",
                  "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  "focus:bg-zinc-100 dark:focus:bg-zinc-800",
                  "transition-colors duration-150",
                  "cursor-pointer"
                )}
              >
                <Wallet className="mr-2.5 h-4 w-4" />
                <span className="font-medium">Disconnect</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-2" />
            </>
          )}

          {/* UTXOS Wallet Option */}
          <div className="px-1 pb-1">
            <DropdownMenuItem
              onSelect={(e) => {
                // Prevent Radix from auto-closing when interacting with nested controls (toggle).
                // We close manually when the user presses Connect/Disconnect.
                e.preventDefault();
              }}
              disabled={isUtxosLoading}
              className={cn(
                "block w-full cursor-default rounded-lg border p-3 transition-colors duration-150",
                isUtxosEnabled &&
                  "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/20",
                // Only tint UTXOS as the suggested path when there's no wallet
                // extension to choose; otherwise keep it neutral.
                !isUtxosEnabled &&
                  wallets.length === 0 &&
                  "border-blue-200 bg-blue-50/70 dark:border-blue-900/60 dark:bg-blue-950/30",
                !isUtxosEnabled &&
                  wallets.length > 0 &&
                  "border-zinc-200 dark:border-zinc-800",
                isUtxosLoading && "cursor-wait opacity-60",
              )}
            >
              {/* Header: brand tile + name + status */}
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-white shadow-sm",
                    isUtxosEnabled
                      ? "bg-gradient-to-br from-emerald-500 to-teal-600"
                      : "bg-gradient-to-br from-blue-500 to-indigo-600",
                  )}
                >
                  {isUtxosEnabled ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      UTXOS
                    </span>
                    {isUtxosEnabled ? (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                        Active
                      </span>
                    ) : wallets.length === 0 ? (
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                        Recommended
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    Email or social login — no extension needed
                  </p>
                </div>
              </div>

              {/* Controls: network toggle + connect/disconnect */}
              <div
                className="mt-3 flex items-center justify-between gap-2"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <ToggleGroup
                  type="single"
                  value={netId === 1 ? "mainnet" : "testnet"}
                  onValueChange={(value) => {
                    if (!value) return;
                    const next = (value === "mainnet" ? 1 : 0) as 0 | 1;
                    if (next === netId) return;

                    if (isUtxosEnabled) {
                      toast({
                        title: "Network switched",
                        description:
                          "Please reconnect your UTXOS wallet for the new network.",
                        variant: "default",
                      });
                    }
                    setNetwork(next);
                  }}
                  className="gap-0.5 rounded-md border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <ToggleGroupItem
                    value="mainnet"
                    size="sm"
                    className={cn(
                      "h-6 px-2 text-[11px] text-zinc-600 dark:text-zinc-300",
                      "data-[state=on]:bg-zinc-900 data-[state=on]:text-white",
                      "dark:data-[state=on]:bg-zinc-100 dark:data-[state=on]:text-zinc-900",
                    )}
                    aria-label="Use mainnet"
                    disabled={isUtxosLoading}
                  >
                    Mainnet
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="testnet"
                    size="sm"
                    className={cn(
                      "h-6 px-2 text-[11px] text-zinc-600 dark:text-zinc-300",
                      "data-[state=on]:bg-zinc-900 data-[state=on]:text-white",
                      "dark:data-[state=on]:bg-zinc-100 dark:data-[state=on]:text-zinc-900",
                    )}
                    aria-label="Use testnet"
                    disabled={isUtxosLoading}
                  >
                    Testnet
                  </ToggleGroupItem>
                </ToggleGroup>
                <Button
                  size="sm"
                  variant={isUtxosEnabled ? "outline" : "default"}
                  disabled={isUtxosLoading}
                  onClick={() => {
                    void (isUtxosEnabled
                      ? handleUtxosDisable()
                      : handleUtxosEnable());
                    setDropdownOpen(false);
                  }}
                >
                  {isUtxosLoading ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      {isUtxosEnabled ? "Disconnecting" : "Connecting"}
                    </>
                  ) : isUtxosEnabled ? (
                    "Disconnect"
                  ) : (
                    "Connect"
                  )}
                </Button>
              </div>
            </DropdownMenuItem>
          </div>

          {wallets.length > 0 && <DropdownMenuSeparator className="my-2" />}

          {wallets.length === 0 ? (
            <div className="px-3 py-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 p-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <AlertCircle className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-1.5">
                      No wallets detected
                    </p>
                    <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                      Please install a Cardano wallet extension to continue.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-0.5">
              <p className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Browser wallets
              </p>
              {wallets.map((wallet) => {
                const isCurrentWallet =
                  isConnected && connectedWalletName === wallet.id;
                return (
                  <DropdownMenuItem
                    key={wallet.id}
                    onClick={() => handleConnectWallet(wallet.id)}
                    disabled={isCurrentWallet || isConnecting}
                    className={cn(
                      "px-3 py-2.5 rounded-md",
                      "transition-all duration-150",
                      "cursor-pointer",
                      isCurrentWallet && [
                        "bg-zinc-100 dark:bg-zinc-800",
                        "border border-zinc-200 dark:border-zinc-700",
                        "font-medium cursor-default",
                      ],
                      !isCurrentWallet && [
                        "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                        "focus:bg-zinc-100 dark:focus:bg-zinc-800",
                      ],
                      isConnecting && "opacity-50 cursor-wait"
                    )}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                          {wallet.icon ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={wallet.icon}
                              alt=""
                              className="h-5 w-5 object-contain"
                            />
                          ) : (
                            <Wallet className="h-3.5 w-3.5 text-zinc-400" />
                          )}
                        </span>
                        <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                          {wallet.name}
                        </span>
                      </div>
                      {isCurrentWallet ? (
                        <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" />
                          Active
                        </span>
                      ) : (
                        <ChevronRight className="h-4 w-4 flex-shrink-0 text-zinc-400" />
                      )}
                    </div>
                  </DropdownMenuItem>
                );
              })}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
