import { Wallet, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import useUser from "@/hooks/useUser";
import { useUserStore } from "@/lib/zustand/user";
import { getProvider } from "@/utils/get-provider";
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
  const setUserAssets = useUserStore((state) => state.setUserAssets);
  const setUserAssetMetadata = useUserStore(
    (state) => state.setUserAssetMetadata,
  );
  const { user, isLoading: userLoading } = useUser();
  const { toast } = useToast();

  // Use WalletContext directly for better state access
  const {
    state,
    connectingWallet,
    connectedWalletName,
    connectWallet: connectWalletContext,
    disconnect,
    setPersist,
    error,
  } = useWalletContext();
  
  // Track wallet detection state
  const [detectingWallets, setDetectingWallets] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const walletsRef = useRef(wallets);
  const hasInitializedPersist = useRef(false);
  const hasAttemptedAutoConnect = useRef(false);

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

  // Process assets and fetch metadata
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
    String(state) === String(WalletState.CONNECTING) || connectingWallet;
  const isLoading = isConnecting || (isConnected && (!user || userLoading));

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
    if (isConnected && isLoading) {
      return (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin transition-opacity duration-300" />
          <span className="font-medium transition-opacity duration-300">Loading...</span>
        </>
      );
    }
    if (isConnected && user && !userLoading) {
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

  return (
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
              : "Connect wallet"
          }
        >
          {getButtonContent()}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={cn(
          "min-w-[280px] max-w-[320px]",
          "rounded-lg border border-zinc-200 dark:border-zinc-800",
          "bg-white dark:bg-zinc-950",
          "shadow-xl backdrop-blur-sm",
          "p-2"
        )}
        sideOffset={8}
        onCloseAutoFocus={(e) => {
          // Prevent focus trap when closing
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
                  {process.env.NODE_ENV === "development" && (
                    <div className="mt-2 p-2 bg-zinc-100 dark:bg-zinc-800 rounded text-xs font-mono text-zinc-600 dark:text-zinc-400">
                      <div>Debug: detectingWallets={String(detectingWallets)}</div>
                      <div>Debug: wallets.length={wallets.length}</div>
                      <div>Debug: Check console for detailed logs</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-0.5">
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
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {isCurrentWallet ? (
                        <CheckCircle2 className="h-4 w-4 text-zinc-600 dark:text-zinc-400 flex-shrink-0" />
                      ) : (
                        <div className="h-4 w-4 rounded-full bg-zinc-300 dark:bg-zinc-700 flex-shrink-0" />
                      )}
                      <span className="truncate">
                        {wallet.name}
                      </span>
                    </div>
                    {isCurrentWallet && (
                      <span className={cn(
                        "text-xs font-medium px-2 py-0.5 rounded-full",
                        "bg-zinc-200 dark:bg-zinc-700",
                        "text-zinc-700 dark:text-zinc-300",
                        "flex-shrink-0 ml-2"
                      )}>
                        Active
                      </span>
                    )}
                  </div>
                </DropdownMenuItem>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
