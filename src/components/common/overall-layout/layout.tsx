import React, { useEffect, Component, ReactNode, useMemo, useCallback, useState, useRef } from "react";
import { useRouter } from "next/router";
import { useAddress } from "@meshsdk/react";
import { publicRoutes } from "@/data/public-routes";
import { api } from "@/utils/api";
import useUser from "@/hooks/useUser";
import { useUserStore } from "@/lib/zustand/user";
import { normalizeAddressToBech32 } from "@/utils/addressCompatibility";
import useAppWallet from "@/hooks/useAppWallet";
import useUTXOS from "@/hooks/useUTXOS";
import useMeshWallet from "@/hooks/useMeshWallet";
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
import dynamic from "next/dynamic";
import Loading from "@/components/common/overall-layout/loading";
import { HEADER_CONNECT_ANCHOR } from "@/lib/wallet-runtime";
import LayoutFrame, { SidebarHomeLink } from "@/components/common/overall-layout/layout-frame";
import { MobileNavigation } from "@/components/ui/mobile-navigation";
import { MobileActionsMenu } from "@/components/ui/mobile-actions-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// The landing page is only the fallback for a signed-out visitor on a private
// route. A static import put the whole landing page (hero, effects, sections)
// into the shared bundle of every route.
const PageHomepage = dynamic(
  () => import("@/components/pages/homepage").then((m) => m.PageHomepage),
  { loading: () => <Loading /> },
);

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
    console.error('[WalletErrorBoundary] Error caught:', error, errorInfo);
    
    // Handle specific wallet errors
    if (error.message.includes("account changed")) {
      console.log("[WalletErrorBoundary] Wallet account changed, reloading page...");
      window.location.reload();
      return;
    }
    
    // Handle UTXOS-specific errors
    if (error.message.includes("UTXOS") || error.message.includes("UTXOS_PROJECT_ID") || error.message.includes("Web3Wallet")) {
      console.log("[WalletErrorBoundary] UTXOS wallet error detected:", error.message);
      // Don't reload for UTXOS errors, let user retry
      return;
    }
    
    // Handle Blockfrost/API errors
    if (error.message.includes("Blockfrost") || error.message.includes("blockfrost") || error.message.includes("429")) {
      console.log("[WalletErrorBoundary] API error detected, may be rate limiting");
      // Don't reload for API errors
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 1.9 IWallet bridge — used for getDRep(), which the react 2.0 wallet lacks.
  const { wallet: meshWallet } = useMeshWallet();
  const { state: walletState, connectedWalletInstance } = useWalletContext();
  // react-2.0's useAddress can return hex-encoded address bytes; user records
  // and sessions are keyed by bech32. Normalize once at the source so every
  // consumer below (store sync, session check) uses the bech32 form.
  const rawAddress = useAddress();
  const address = rawAddress ? normalizeAddressToBech32(rawAddress) : rawAddress;
  const { user, isLoading: isLoadingUser } = useUser();
  const router = useRouter();
  const { appWallet } = useAppWallet();
  const { multisigWallet } = useMultisigWallet();
  const { isEnabled: isUtxosEnabled, wallet: utxosWallet } = useUTXOS();

  const userAddress = useUserStore((state) => state.userAddress);
  const setUserAddress = useUserStore((state) => state.setUserAddress);
  const reauthNonce = useUserStore((state) => state.reauthNonce);
  const ctx = api.useUtils();
  
  // State for wallet authorization modal
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [checkingSession, setCheckingSession] = useState(false);
  const [hasCheckedSession, setHasCheckedSession] = useState(false); // Prevent duplicate checks
  const [showPostAuthLoading, setShowPostAuthLoading] = useState(false); // Show loading after authorization


  // Use WalletState for connection check
  const connected = String(walletState) === String(WalletState.CONNECTED);
  const anyWalletConnected = connected || isUtxosEnabled;
  // Use connectedWalletInstance if available, otherwise fall back to wallet
  const activeWallet = connectedWalletInstance && Object.keys(connectedWalletInstance).length > 0
    ? connectedWalletInstance
    : meshWallet;

  // Global error handler for unhandled promise rejections
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      // Handle wallet-related errors specifically
      if (event.reason && typeof event.reason === 'object') {
        const error = event.reason as Error;
        if (error.message && error.message.includes("account changed")) {
          console.log("[GlobalHandler] Account changed error, reloading page...");
          event.preventDefault(); // Prevent the error from being logged to console
          window.location.reload();
          return;
        }
        
        // Handle UTXOS-specific errors
        if (error.message && (error.message.includes("UTXOS") || error.message.includes("Web3Wallet"))) {
          console.log("[GlobalHandler] UTXOS error caught:", error.message);
          event.preventDefault(); // Prevent unhandled rejection log
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
            setUserAddress(normalizeAddressToBech32(addresses[0]!));
            fetchingAddressRef.current = false;
          } else {
            return activeWallet.getUnusedAddresses();
          }
        })
        .then((addresses) => {
          if (addresses && addresses.length > 0 && !userAddress) {
            setUserAddress(normalizeAddressToBech32(addresses[0]!));
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
      if (!walletAddress || !activeWallet) return;

      try {
        // Get stake address
        const stakeAddresses = await activeWallet.getRewardAddresses();
        const stakeAddress = stakeAddresses[0];
        if (!stakeAddress) {
          return;
        }

        // Get DRep key hash (optional). getDRep only exists on the 1.9 IWallet,
        // so use the bridged wallet; if it isn't enabled yet, skip silently.
        let drepKeyHash = "";
        try {
          const dRepKey = await meshWallet?.getDRep();
          if (dRepKey?.publicKeyHash) {
            drepKeyHash = dRepKey.publicKeyHash;
          }
        } catch {
          // DRep key is optional
        }

        // Create or update user
        createUser({
          address: walletAddress,
          stakeAddress,
          drepKeyHash,
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("account changed")) {
          window.location.reload();
        }
      }
    }

    initializeWallet();
  }, [connected, activeWallet, meshWallet, user, userAddress, address, createUser]);

  // Check wallet session and show authorization modal for first-time connections
  // Check session as soon as wallet is connected and address is available (don't wait for user)
  // Use userAddress from store (which we set from wallet) instead of address from hook
  const walletAddressForSession = userAddress || address;
  // Only check session once per wallet connection (prevent duplicate checks)
  const shouldCheckSession = !!anyWalletConnected && !!walletAddressForSession && !checkingSession && !hasCheckedSession && walletAddressForSession.length > 0;
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
    if (!anyWalletConnected || !walletAddressForCheck || walletAddressForCheck.length === 0 || showAuthModal || checkingSession || hasCheckedSession) {
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
  }, [anyWalletConnected, user, userAddress, address, walletSessionData, showAuthModal, checkingSession, isLoadingWalletSession, hasCheckedSession]);
  
  // Reset hasCheckedSession when wallet disconnects or address changes
  useEffect(() => {
    if (!anyWalletConnected) {
      setHasCheckedSession(false);
      setCheckingSession(false);
      setShowAuthModal(false);
    }
  }, [anyWalletConnected]);
  
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

  // Manual re-authorization: when the user is connected but never got a
  // session (e.g. the auto-authorize failed/was cancelled), hasCheckedSession
  // stays true and the modal never reopens — leaving the connect button stuck
  // on "Loading…". Bumping reauthNonce (from the connect dropdown) clears that
  // latch and refetches the session so the session-check effect reopens the
  // auth modal.
  useEffect(() => {
    if (reauthNonce > 0) {
      setHasCheckedSession(false);
      setCheckingSession(false);
      setShowAuthModal(false);
      void refetchWalletSession();
    }
  }, [reauthNonce, refetchWalletSession]);

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

    // Create/ensure the User row now that the wallet session cookie exists.
    //
    // createUser is a protectedProcedure (it needs a session). The onboarding
    // effects fire createUser on *connect* (regular wallets in initializeWallet
    // below; UTXOS in connect-wallet) — which happens seconds before the user
    // approves the signing prompt — so that first attempt always runs
    // unauthenticated and is rejected UNAUTHORIZED, and it never retries once the
    // cookie lands. The result: useUser() stays null and the connect button is
    // stuck on "Authorize" even though signing succeeded. Re-run it here, after
    // authorization, when the cookie is actually present — for both regular
    // browser wallets and the UTXOS smart wallet.
    try {
      const authedAddress = userAddress || address;
      if (authedAddress) {
        let stakeAddress: string | undefined;
        let drepKeyHash = "";

        if (activeWallet) {
          // Regular browser wallet: stake from the wallet, DRep from the 1.9 IWallet.
          stakeAddress = (await activeWallet.getRewardAddresses())[0];
          try {
            const dRepKey = await meshWallet?.getDRep();
            if (dRepKey?.publicKeyHash) {
              drepKeyHash = dRepKey.publicKeyHash;
            }
          } catch {
            // DRep key is optional
          }
        } else if (isUtxosEnabled && utxosWallet?.cardano) {
          // UTXOS smart wallet: stake + DRep come from its CIP-30 interface.
          stakeAddress = (await utxosWallet.cardano.getRewardAddresses())[0];
          try {
            if (typeof utxosWallet.cardano.getDRep === "function") {
              const dRepKey = await utxosWallet.cardano.getDRep();
              if (dRepKey && typeof dRepKey === "object" && "publicKeyHash" in dRepKey) {
                drepKeyHash = (dRepKey as { publicKeyHash: string }).publicKeyHash;
              }
            }
          } catch {
            // DRep key is optional
          }
        }

        if (stakeAddress) {
          createUser({
            address: authedAddress,
            stakeAddress: normalizeAddressToBech32(stakeAddress),
            drepKeyHash,
          });
        }
      }
    } catch {
      // Non-fatal: the onboarding effects will retry on a later render now that
      // the session cookie is present.
    }

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
  }, [refetchWalletSession, ctx.wallet, userAddress, address, activeWallet, meshWallet, isUtxosEnabled, utxosWallet, createUser]);

  // Memoize computed route values
  const isWalletPath = useMemo(() => router.pathname.includes("/wallets/[wallet]"), [router.pathname]);
  const walletPageRoute = useMemo(() => router.pathname.split("/wallets/[wallet]/")[1], [router.pathname]);
  const walletPageNames = useMemo(() => walletPageRoute ? walletPageRoute.split("/") : [], [walletPageRoute]);
  // OAuth flow pages must render for a signed-out visitor — arriving without a
  // connected wallet is the normal case for a consent screen, since the user is
  // being sent here by a third-party client. They are not marketing surfaces,
  // so they render without the site footer.
  const isAuthFlow = useMemo(() => router.pathname.startsWith("/oauth/"), [router.pathname]);
  const pageIsPublic = useMemo(
    () => publicRoutes.includes(router.pathname) || isAuthFlow,
    [router.pathname, isAuthFlow],
  );
  const isLoggedIn = useMemo(() => !!user, [user]);
  const isHomepage = useMemo(() => router.pathname === "/", [router.pathname]);
  // Marketing footer on public surfaces, but not on the logged-in homepage
  // (which renders the wallet dashboard rather than the landing page).
  const showFooter = useMemo(
    () => pageIsPublic && !isAuthFlow && !(isHomepage && isLoggedIn),
    [pageIsPublic, isAuthFlow, isHomepage, isLoggedIn],
  );

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
    <LayoutFrame
      compactLogo={isLoggedIn || !isHomepage}
      showSidebar={isLoggedIn || !isHomepage}
      showFooter={showFooter}
      overlay={
        <>
          {(shouldShowBackgroundLoading || showPostAuthLoading) && (
            <div className="fixed inset-0 z-50 opacity-100 transition-opacity duration-300 ease-in-out">
              <Loading />
            </div>
          )}
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
        </>
      }
      mobileNav={
        // Mobile menu button - hidden only on public homepage (not logged in)
        (isLoggedIn || !isHomepage) && (
          <MobileNavigation
            showWalletMenu={showWalletMenu}
            isLoggedIn={isLoggedIn}
            walletId={walletIdForMenu}
            fallbackWalletName={lastVisitedWalletName}
            onClearWallet={clearWalletContext}
            stakingEnabled={lastWalletStakingEnabled ?? undefined}
            isWalletPath={isWalletPath}
          />
        )
      }
      headerRight={
        !isLoggedIn ? (
          // On the homepage, the hero renders the wallet connector (avoid double-mount).
          // On all other routes, show it in the header.
          isHomepage ? null : (
            <ConnectWallet
              key="wallet-connector"
              variant="compact"
              connectAnchor={HEADER_CONNECT_ANCHOR}
            />
          )
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
        )
      }
      sidebar={
        <>
          {/* 1. Home Link - only when NOT logged in */}
          {!isLoggedIn && <SidebarHomeLink />}

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
        </>
      }
    >
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
        {pageIsPublic || userAddress ? children : <PageHomepage />}
      </WalletErrorBoundary>
    </LayoutFrame>
  );
}
