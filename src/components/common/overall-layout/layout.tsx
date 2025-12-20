import React, { useEffect, Component, ReactNode, useMemo, useCallback, useState, useRef } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useNostrChat } from "@jinglescode/nostr-chat-plugin";
import { useWallet, useAddress } from "@meshsdk/react";
import { publicRoutes } from "@/data/public-routes";
import { api } from "@/utils/api";
import useUser from "@/hooks/useUser";
import { useUserStore } from "@/lib/zustand/user";
import useAppWallet from "@/hooks/useAppWallet";
import { useWalletContext, WalletState } from "@/hooks/useWalletContext";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import { AlertCircle, RefreshCw } from "lucide-react";
import { WalletAuthModal } from "@/components/common/modals/WalletAuthModal";

import SessionProvider from "@/components/SessionProvider";
import { getServerSession } from "next-auth";

import MenuWallets from "@/components/common/overall-layout/menus/wallets";
import MenuWallet from "@/components/common/overall-layout/menus/multisig-wallet";
import WalletSelector from "@/components/common/overall-layout/wallet-selector";
import {
  WalletDataLoaderWrapper,
  DialogReportWrapper,
  UserDropDownWrapper,
} from "@/components/common/overall-layout/mobile-wrappers";
import LogoutWrapper from "@/components/common/overall-layout/mobile-wrappers/logout-wrapper";
import { PageHomepage } from "@/components/pages/homepage";
import Logo from "@/components/common/overall-layout/logo";
import dynamic from "next/dynamic";
import Loading from "@/components/common/overall-layout/loading";
import { MobileNavigation } from "@/components/ui/mobile-navigation";
import { MobileActionsMenu } from "@/components/ui/mobile-actions-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Dynamically import ConnectWallet with SSR disabled to avoid production SSR issues
// Using a version-based key ensures fresh mount on updates, preventing cache issues
const ConnectWallet = dynamic(
  () => import("@/components/common/cardano-objects/connect-wallet"),
  { 
    ssr: false,
    // Force re-mount on navigation to handle cache issues
    loading: () => null,
  }
);

// Enhanced error boundary component for wallet errors
class WalletErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    // Handle specific wallet errors
    if (error.message.includes("account changed")) {
      window.location.reload();
      return;
    }
  }

  render() {
    if (this.state.hasError && this.state.error && !this.state.error.message.includes("account changed")) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// Component to track layout content changes
function LayoutContentTracker({ 
  children, 
  router, 
  pageIsPublic, 
  userAddress 
}: { 
  children: ReactNode; 
  router: ReturnType<typeof useRouter>;
  pageIsPublic: boolean;
  userAddress: string | undefined;
}) {
  const prevPathRef = useRef<string>(router.pathname);
  const prevQueryRef = useRef<string>(JSON.stringify(router.query));
  
  useEffect(() => {
    const handleRouteChangeStart = (url: string) => {
      // Route change started
    };
    
    const handleRouteChangeComplete = (url: string) => {
      prevPathRef.current = router.pathname;
      prevQueryRef.current = JSON.stringify(router.query);
    };
    
    const handleRouteChangeError = (err: Error, url: string) => {
      // Route change error
    };
    
    router.events.on('routeChangeStart', handleRouteChangeStart);
    router.events.on('routeChangeComplete', handleRouteChangeComplete);
    router.events.on('routeChangeError', handleRouteChangeError);
    
    return () => {
      router.events.off('routeChangeStart', handleRouteChangeStart);
      router.events.off('routeChangeComplete', handleRouteChangeComplete);
      router.events.off('routeChangeError', handleRouteChangeError);
    };
  }, [router]);
  
  useEffect(() => {
    if (router.pathname !== prevPathRef.current || JSON.stringify(router.query) !== prevQueryRef.current) {
      prevPathRef.current = router.pathname;
      prevQueryRef.current = JSON.stringify(router.query);
    }
  }, [router.pathname, router.query]);
  
  return <>{children}</>;
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { wallet } = useWallet();
  const { state: walletState, connectedWalletInstance } = useWalletContext();
  const address = useAddress();
  const { user, isLoading: isLoadingUser } = useUser();
  const router = useRouter();
  const { appWallet } = useAppWallet();
  const { multisigWallet } = useMultisigWallet();
  const { generateNsec } = useNostrChat();

  const userAddress = useUserStore((state) => state.userAddress);
  const setUserAddress = useUserStore((state) => state.setUserAddress);
  const ctx = api.useUtils();
  
  // State for wallet authorization modal
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [checkingSession, setCheckingSession] = useState(false);
  const [hasCheckedSession, setHasCheckedSession] = useState(false); // Prevent duplicate checks
  const [showPostAuthLoading, setShowPostAuthLoading] = useState(false); // Show loading after authorization
  
  // Use WalletState for connection check
  const connected = String(walletState) === String(WalletState.CONNECTED);
  // Use connectedWalletInstance if available, otherwise fall back to wallet
  const activeWallet = connectedWalletInstance && Object.keys(connectedWalletInstance).length > 0 
    ? connectedWalletInstance 
    : wallet;

  // Global error handler for unhandled promise rejections
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      // Handle wallet-related errors specifically
      if (event.reason && typeof event.reason === 'object') {
        const error = event.reason as Error;
        if (error.message && error.message.includes("account changed")) {
          event.preventDefault(); // Prevent the error from being logged to console
          window.location.reload();
          return;
        }
        // Handle "too many requests" errors silently (rate limiting)
        if (error.message && error.message.includes("too many requests")) {
          event.preventDefault(); // Prevent the error from being logged to console
          return;
        }
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  const { mutate: createUser } = api.user.createUser.useMutation({
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await ctx.user.getUserByAddress.cancel({ address: variables.address });
      
      // Snapshot previous value
      const previous = ctx.user.getUserByAddress.getData({ address: variables.address });
      
      // Optimistically update (only if old exists, otherwise wait for server response)
      if (previous) {
        ctx.user.getUserByAddress.setData(
          { address: variables.address },
          {
            ...previous,
            address: variables.address,
            stakeAddress: variables.stakeAddress,
            drepKeyHash: variables.drepKeyHash ?? "",
            nostrKey: variables.nostrKey,
          }
        );
      }
      
      return { previous };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previous) {
        ctx.user.getUserByAddress.setData({ address: variables.address }, context.previous);
      }
      // Error creating user - handled silently
    },
    onSuccess: (_, variables) => {
      // Invalidate to ensure we have the latest data
      void ctx.user.getUserByAddress.invalidate({ address: variables.address });
    },
  });
  const { mutate: updateUser } = api.user.updateUser.useMutation({
    onMutate: async (variables) => {
      // Only do optimistic update if address is provided
      if (!variables.address) {
        return { previous: undefined };
      }
      
      // Cancel outgoing refetches
      await ctx.user.getUserByAddress.cancel({ address: variables.address });
      
      // Snapshot previous value
      const previous = ctx.user.getUserByAddress.getData({ address: variables.address });
      
      // Optimistically update
      if (previous) {
        ctx.user.getUserByAddress.setData(
          { address: variables.address },
          {
            ...previous,
            ...(variables.address && { address: variables.address }),
            ...(variables.stakeAddress && { stakeAddress: variables.stakeAddress }),
            ...(variables.drepKeyHash && { drepKeyHash: variables.drepKeyHash }),
          }
        );
      }
      
      return { previous };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previous && variables.address) {
        ctx.user.getUserByAddress.setData({ address: variables.address }, context.previous);
      }
      // Error updating user - handled silently
    },
    onSuccess: (_, variables) => {
      if (variables.address) {
        void ctx.user.getUserByAddress.invalidate({ address: variables.address });
      }
    },
  });

  // Sync address from hook to store
  useEffect(() => {
    if (address) {
      setUserAddress(address);
    }
  }, [address, setUserAddress]);
  
  // Also try to get address from wallet directly if useAddress doesn't work
  const fetchingAddressRef = useRef(false);
  useEffect(() => {
    // Prevent multiple simultaneous calls
    if (fetchingAddressRef.current) return;
    
    if (connected && activeWallet && !address && !userAddress) {
      fetchingAddressRef.current = true;
      activeWallet.getUsedAddresses()
        .then((addresses) => {
          if (addresses && addresses.length > 0) {
            setUserAddress(addresses[0]!);
            fetchingAddressRef.current = false;
          } else {
            return activeWallet.getUnusedAddresses();
          }
        })
        .then((addresses) => {
          if (addresses && addresses.length > 0 && !userAddress) {
            setUserAddress(addresses[0]!);
          }
          fetchingAddressRef.current = false;
        })
        .catch((error) => {
          // Handle "too many requests" error gracefully
          if (error instanceof Error && error.message.includes("too many requests")) {
            // Silently ignore rate limit errors - address will be fetched later
          }
          fetchingAddressRef.current = false;
        });
    }
  }, [connected, activeWallet, address, userAddress, setUserAddress]);

  // Initialize wallet and create user when connected
  useEffect(() => {
    // Use userAddress from store instead of address from hook (hook might not work)
    const walletAddress = userAddress || address;
    if (!connected || !activeWallet || user || !walletAddress) {
      return;
    }

    async function initializeWallet() {
      if (!walletAddress) return;
      
      try {
        // Get stake address
        const stakeAddresses = await activeWallet.getRewardAddresses();
        const stakeAddress = stakeAddresses[0];
        if (!stakeAddress) {
          return;
        }

        // Get DRep key hash (optional)
        let drepKeyHash = "";
        try {
          const dRepKey = await activeWallet.getDRep();
          if (dRepKey?.publicKeyHash) {
            drepKeyHash = dRepKey.publicKeyHash;
          }
        } catch {
          // DRep key is optional
        }

        // Create or update user
        const nostrKey = generateNsec();
        createUser({
          address: walletAddress,
          stakeAddress,
          drepKeyHash,
          nostrKey: JSON.stringify(nostrKey),
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("account changed")) {
          window.location.reload();
        }
      }
    }

    initializeWallet();
  }, [connected, activeWallet, user, userAddress, address, createUser, generateNsec]);

  // Check wallet session and show authorization modal for first-time connections
  // Check session as soon as wallet is connected and address is available (don't wait for user)
  // Use userAddress from store (which we set from wallet) instead of address from hook
  const walletAddressForSession = userAddress || address;
  // Only check session once per wallet connection (prevent duplicate checks)
  const shouldCheckSession = !!connected && !!walletAddressForSession && !checkingSession && !hasCheckedSession && walletAddressForSession.length > 0;
  const { data: walletSessionData, isLoading: isLoadingWalletSession, refetch: refetchWalletSession } = api.auth.getWalletSession.useQuery(
    { address: walletAddressForSession ?? "" },
    { 
      enabled: shouldCheckSession,
      refetchOnWindowFocus: false,
      refetchOnMount: false, // Don't refetch on mount to prevent duplicate checks
    }
  );
  

  useEffect(() => {
    // Only check session once per wallet connection
    // Use userAddress from store (which we set from wallet) instead of address from hook
    const walletAddressForCheck = userAddress || address;
    if (!connected || !walletAddressForCheck || walletAddressForCheck.length === 0 || showAuthModal || checkingSession || hasCheckedSession) {
      return;
    }

    // Wait for query to finish loading
    if (isLoadingWalletSession) {
      return;
    }

    // Check if wallet has an active session
    // Only show modal if we have data (not undefined) and wallet is not authorized
    if (walletSessionData !== undefined) {
      setHasCheckedSession(true); // Mark as checked to prevent duplicate checks
      const hasSession = walletSessionData.authorized ?? false;
      
      if (!hasSession) {
        // Wallet is connected but doesn't have a session - show authorization modal
        setCheckingSession(true);
        setShowAuthModal(true);
      }
    }
  }, [connected, user, userAddress, address, walletSessionData, showAuthModal, checkingSession, isLoadingWalletSession, hasCheckedSession]);
  
  // Reset hasCheckedSession when wallet disconnects or address changes
  useEffect(() => {
    if (!connected) {
      setHasCheckedSession(false);
      setCheckingSession(false);
      setShowAuthModal(false);
    }
  }, [connected]);
  
  // Reset hasCheckedSession when address changes (different wallet connected)
  const prevAddressRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const currentAddress = userAddress || address;
    if (prevAddressRef.current !== undefined && prevAddressRef.current !== currentAddress) {
      // Address changed, reset session check
      setHasCheckedSession(false);
      setCheckingSession(false);
      setShowAuthModal(false);
    }
    prevAddressRef.current = currentAddress;
  }, [userAddress, address]);

  const handleAuthModalClose = useCallback(() => {
    setShowAuthModal(false);
    setCheckingSession(false);
    setHasCheckedSession(true); // Mark as checked to prevent showing modal again
    // Don't refetch here - let the natural query refetch handle it if needed
  }, []);

  const handleAuthModalAuthorized = useCallback(async () => {
    setShowAuthModal(false);
    setCheckingSession(false);
    setHasCheckedSession(true); // Mark as checked so we don't check again
    // Show loading skeleton for smooth transition
    setShowPostAuthLoading(true);
    
    // Wait a moment for the cookie to be set by the browser, then refetch session
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Refetch session to update state
    await refetchWalletSession();
    
    // Invalidate wallet queries so they refetch with the new session
    // Use a small delay to ensure cookie is available on subsequent requests
    setTimeout(() => {
      const userAddressForInvalidation = userAddress || address;
      if (userAddressForInvalidation) {
        void ctx.wallet.getUserWallets.invalidate({ address: userAddressForInvalidation });
        void ctx.wallet.getUserNewWallets.invalidate({ address: userAddressForInvalidation });
        void ctx.wallet.getUserNewWalletsNotOwner.invalidate({ address: userAddressForInvalidation });
      }
    }, 300);
    
    // Hide loading after a brief delay to allow data to load
    setTimeout(() => {
      setShowPostAuthLoading(false);
    }, 1500);
  }, [refetchWalletSession, ctx.wallet, userAddress, address]);

  // Memoize computed route values
  const isWalletPath = useMemo(() => router.pathname.includes("/wallets/[wallet]"), [router.pathname]);
  const walletPageRoute = useMemo(() => router.pathname.split("/wallets/[wallet]/")[1], [router.pathname]);
  const walletPageNames = useMemo(() => walletPageRoute ? walletPageRoute.split("/") : [], [walletPageRoute]);
  const pageIsPublic = useMemo(() => publicRoutes.includes(router.pathname), [router.pathname]);
  const isLoggedIn = useMemo(() => !!user, [user]);
  const isHomepage = useMemo(() => router.pathname === "/", [router.pathname]);

  // Keep track of the last visited wallet to show wallet menu even on other pages
  const [lastVisitedWalletId, setLastVisitedWalletId] = React.useState<string | null>(null);
  const [lastVisitedWalletName, setLastVisitedWalletName] = React.useState<string | null>(null);
  const [lastWalletStakingEnabled, setLastWalletStakingEnabled] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    const walletId = router.query.wallet as string | undefined;
    if (walletId && isWalletPath && appWallet && multisigWallet) {
      setLastVisitedWalletId(walletId);
      setLastVisitedWalletName(appWallet.name);
      // Check if staking is enabled for this wallet
      try {
        const stakingEnabled = multisigWallet.stakingEnabled();
        setLastWalletStakingEnabled(stakingEnabled);
      } catch (error) {
        // Don't update state on error - keep the last known value
      }
    }
  }, [router.query.wallet, isWalletPath, appWallet, multisigWallet]);

  const clearWalletContext = useCallback(() => {
    setLastVisitedWalletId(null);
    setLastVisitedWalletName(null);
    setLastWalletStakingEnabled(null);
  }, []);

  // Clear wallet context when navigating to homepage
  React.useEffect(() => {
    if (isHomepage && lastVisitedWalletId) {
      clearWalletContext();
    }
  }, [isHomepage, lastVisitedWalletId, clearWalletContext]);

  // Memoize computed values
  const showWalletMenu = useMemo(() => isLoggedIn && (isWalletPath || !!lastVisitedWalletId), [isLoggedIn, isWalletPath, lastVisitedWalletId]);

  // Don't show background loading when wallet is connecting or just connected (button already shows spinner)
  // The connect button shows a spinner when: connecting OR (connected && address exists but user doesn't exist yet and user is loading)
  const isConnecting = useMemo(() => String(walletState) === String(WalletState.CONNECTING), [walletState]);
  // Only show button spinner if we're actually connecting, or if we have an address but no user yet
  const isButtonShowingSpinner = useMemo(() => {
    const result = isConnecting || (connected && !!address && !user && isLoadingUser);
    return result;
  }, [isConnecting, connected, address, user, isLoadingUser]);
  
  // Only show background loading if:
  // 1. User is loading AND user doesn't exist yet (if user exists, no need to show loading)
  // 2. We have an address (user query is actually running)
  // 3. The button spinner is not showing (to avoid double spinners)
  // 4. User address is set (to ensure query is enabled)
  const shouldShowBackgroundLoading = useMemo(() => {
    // Don't show loading if user already exists (even if query is still loading)
    if (user) {
      return false;
    }
    const result = isLoadingUser && !!address && address.length > 0 && !!userAddress && !isButtonShowingSpinner;
    return result;
  }, [isLoadingUser, address, userAddress, isButtonShowingSpinner, user]);
  
  // Memoize wallet ID for menu
  const walletIdForMenu = useMemo(() => (router.query.wallet as string) || lastVisitedWalletId || undefined, [router.query.wallet, lastVisitedWalletId]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      {(shouldShowBackgroundLoading || showPostAuthLoading) && (
        <div className="fixed inset-0 z-50 transition-opacity duration-300 ease-in-out opacity-100">
          <Loading />
        </div>
      )}

      {/* Header - full width, always on top */}
      <header
        className="pointer-events-auto relative z-[100] border-b border-gray-300/50 bg-muted/40 pl-2 pr-4 dark:border-white/[0.03] lg:pl-4 lg:pr-6"
        data-header="main"
      >
          <div className="flex h-14 items-center gap-4 lg:h-16">
            {/* Mobile menu button - hidden only on public homepage (not logged in) */}
              {(isLoggedIn || !isHomepage) && (
              <MobileNavigation
                showWalletMenu={showWalletMenu}
                isLoggedIn={isLoggedIn}
                walletId={walletIdForMenu}
                fallbackWalletName={lastVisitedWalletName}
                onClearWallet={clearWalletContext}
                stakingEnabled={lastWalletStakingEnabled ?? undefined}
                isWalletPath={isWalletPath}
              />
            )}

            {/* Logo - in fixed-width container matching sidebar width */}
            <div className={`flex items-center md:w-[260px] lg:w-[280px] ${(isLoggedIn || !isHomepage) ? 'flex-1 justify-center md:flex-none md:justify-start' : ''}`}>
              <Link
                href="/"
                className="flex items-center gap-2 rounded-md px-4 py-2 text-sm transition-all duration-200 hover:bg-gray-100/50 dark:hover:bg-white/5 md:px-4"
              >
                <Logo />
                <span className="select-none font-medium tracking-[-0.01em]" style={{ fontSize: '17px' }}>
                  Multisig Platform
                </span>
              </Link>
            </div>

            {/* Right: Control buttons */}
            <div className="ml-auto flex items-center gap-2">
              {!connected ? (
                <ConnectWallet key="wallet-connector" />
              ) : (
                <>
                  {/* Desktop buttons */}
                  <div className="hidden items-center space-x-2 md:flex">
                    <WalletDataLoaderWrapper mode="button" />
                    <DialogReportWrapper mode="button" />
                    <UserDropDownWrapper mode="button" />
                  </div>
                  {/* Mobile actions menu */}
                  <MobileActionsMenu>
                    <WalletDataLoaderWrapper mode="menu-item" />
                    <DialogReportWrapper mode="menu-item" />
                    <UserDropDownWrapper mode="menu-item" />
                    <div className="-mx-2 my-1 h-px bg-border" />
                    <LogoutWrapper mode="menu-item" />
                  </MobileActionsMenu>
                </>
              )}
            </div>
          </div>
      </header>

      {/* Content area with sidebar + main */}
      <div className={`flex flex-1 overflow-hidden`}>
        {/* Sidebar for larger screens - hidden only on public homepage (not logged in) */}
        {(isLoggedIn || !isHomepage) && (
          <aside className="hidden w-[260px] border-r border-gray-300/50 bg-muted/40 dark:border-white/[0.03] md:block lg:w-[280px]">
            <div className="flex h-full max-h-screen flex-col">
              <nav className="flex-1 pt-2 overflow-y-auto">
                <div className="flex flex-col">
                  {/* 1. Home Link - only when NOT logged in */}
                  {!isLoggedIn && (
                    <div className="px-2 lg:px-4">
                      <div className="space-y-1">
                        <Link
                          href="/"
                          className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-200 hover:bg-gray-100/50 dark:hover:bg-white/5 ${
                            router.pathname === "/"
                              ? "text-white"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                          </svg>
                          <span>Home</span>
                        </Link>
                      </div>
                    </div>
                  )}

                  {/* 2. Wallet Selector - only when logged in */}
                  {isLoggedIn && (
                    <WalletSelector
                      fallbackWalletName={lastVisitedWalletName}
                      onClearWallet={clearWalletContext}
                    />
                  )}

                  {/* 3. Wallet Menu - shown when wallet is selected */}
                  {showWalletMenu && (
                    <div className="mt-4">
                      <MenuWallet
                        walletId={walletIdForMenu}
                        stakingEnabled={isWalletPath ? undefined : (lastWalletStakingEnabled ?? undefined)}
                      />
                    </div>
                  )}

                  {/* 4. Resources Menu - always visible */}
                  <div className="mt-4">
                    <MenuWallets />
                  </div>
                </div>
              </nav>
              <div className="mt-auto p-4" />
            </div>
          </aside>
        )}

        {/* Main content */}
        <main className="relative flex flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden p-4 md:p-8">
          <WalletErrorBoundary
            fallback={
              <div className="flex flex-col items-center justify-center h-full min-h-[400px] px-4">
                <Card className="w-full max-w-md border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm shadow-lg">
                  <CardContent className="flex flex-col items-center text-center p-8 space-y-6">
                    <div className="relative">
                      <div className="absolute inset-0 bg-red-500/10 dark:bg-red-500/20 rounded-full blur-xl" />
                      <div className="relative flex items-center justify-center w-20 h-20 rounded-full bg-red-50 dark:bg-red-950/30 border-2 border-red-200 dark:border-red-900/50">
                        <AlertCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                        Something went wrong
                      </h2>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-sm">
                        Please try refreshing the page or reconnecting your wallet.
                      </p>
                    </div>
                    
                    <Button
                      onClick={() => window.location.reload()}
                      className="w-full sm:w-auto min-w-[140px]"
                      size="lg"
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Refresh Page
                    </Button>
                  </CardContent>
                </Card>
              </div>
            }
          >
            <LayoutContentTracker router={router} pageIsPublic={pageIsPublic} userAddress={userAddress}>
              {pageIsPublic || userAddress ? children : <PageHomepage />}
            </LayoutContentTracker>
          </WalletErrorBoundary>
        </main>
      </div>
      
      {/* Wallet Authorization Modal - shows when wallet is connected but not authorized */}
      {(userAddress || address) && (
        <WalletAuthModal
          address={userAddress || address || ""}
          open={showAuthModal}
          onClose={handleAuthModalClose}
          onAuthorized={handleAuthModalAuthorized}
          autoAuthorize={true}
        />
      )}
    </div>
  );
}
