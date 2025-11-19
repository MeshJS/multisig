import React, { useEffect, Component, ReactNode } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useNostrChat } from "@jinglescode/nostr-chat-plugin";
import { useWallet, useAddress } from "@meshsdk/react";
import { publicRoutes } from "@/data/public-routes";
import { api } from "@/utils/api";
import useUser from "@/hooks/useUser";
import { useUserStore } from "@/lib/zustand/user";
import useAppWallet from "@/hooks/useAppWallet";
import useMultisigWallet from "@/hooks/useMultisigWallet";

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
    console.error('Error caught by wallet boundary:', error, errorInfo);
    
    // Handle specific wallet errors
    if (error.message.includes("account changed")) {
      console.log("Wallet account changed error caught by boundary, reloading page...");
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { connected, wallet } = useWallet();
  const address = useAddress();
  const { user, isLoading } = useUser();
  const router = useRouter();
  const { appWallet } = useAppWallet();
  const { multisigWallet } = useMultisigWallet();
  const { generateNsec } = useNostrChat();

  const userAddress = useUserStore((state) => state.userAddress);
  const setUserAddress = useUserStore((state) => state.setUserAddress);
  const ctx = api.useUtils();

  // Global error handler for unhandled promise rejections
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event.reason);
      
      // Handle wallet-related errors specifically
      if (event.reason && typeof event.reason === 'object') {
        const error = event.reason as Error;
        if (error.message && error.message.includes("account changed")) {
          console.log("Account changed error caught by global handler, reloading page...");
          event.preventDefault(); // Prevent the error from being logged to console
          window.location.reload();
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
    onSuccess: (_, variables) => {
      console.log("User created/updated successfully, invalidating user query");
      // Invalidate the user query so it refetches the newly created user
      void ctx.user.getUserByAddress.invalidate({ address: variables.address });
    },
    onError: (e) => {
      console.error("Error creating user:", e);
    },
  });
  const { mutate: updateUser } = api.user.updateUser.useMutation({
    onSuccess: (_, variables) => {
      console.log("User updated successfully, invalidating user query");
      void ctx.user.getUserByAddress.invalidate({ address: variables.address });
    },
    onError: (e) => {
      console.error("Error updating user:", e);
    },
  });

  // Sync address from hook to store
  useEffect(() => {
    if (address) {
      setUserAddress(address);
    }
  }, [address, setUserAddress]);

  // Initialize wallet and create user when connected
  useEffect(() => {
    if (!connected || !wallet || user || !address) return;

    async function initializeWallet() {
      if (!address) return;
      
      try {
        // Get stake address
        const stakeAddresses = await wallet.getRewardAddresses();
        const stakeAddress = stakeAddresses[0];
        if (!stakeAddress) return;

        // Get DRep key hash (optional)
        let drepKeyHash = "";
        try {
          const dRepKey = await wallet.getDRep();
          if (dRepKey?.publicKeyHash) {
            drepKeyHash = dRepKey.publicKeyHash;
          }
        } catch {
          // DRep key is optional
        }

        // Create or update user
        const nostrKey = generateNsec();
        createUser({
          address,
          stakeAddress,
          drepKeyHash,
          nostrKey: JSON.stringify(nostrKey),
        });
      } catch (error) {
        console.error("Error initializing wallet:", error);
        if (error instanceof Error && error.message.includes("account changed")) {
          window.location.reload();
        }
      }
    }

    initializeWallet();
  }, [connected, wallet, user, address, createUser, generateNsec]);

  const isWalletPath = router.pathname.includes("/wallets/[wallet]");
  const walletPageRoute = router.pathname.split("/wallets/[wallet]/")[1];
  const walletPageNames = walletPageRoute ? walletPageRoute.split("/") : [];
  const pageIsPublic = publicRoutes.includes(router.pathname);
  const isLoggedIn = !!user;
  const isHomepage = router.pathname === "/";

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
        console.error("Error checking staking status:", error);
      }
    }
  }, [router.query.wallet, isWalletPath, appWallet, multisigWallet]);

  const clearWalletContext = React.useCallback(() => {
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

  const showWalletMenu = isLoggedIn && (isWalletPath || !!lastVisitedWalletId);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      {isLoading && <Loading />}

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
                walletId={router.query.wallet as string || lastVisitedWalletId || undefined}
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
                        walletId={router.query.wallet as string || lastVisitedWalletId || undefined}
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
              <div className="flex flex-col items-center justify-center h-full">
                <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
                <p className="text-gray-600 mb-4">Please try refreshing the page or reconnecting your wallet.</p>
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Refresh Page
                </button>
              </div>
            }
          >
            {pageIsPublic || userAddress ? children : <PageHomepage />}
          </WalletErrorBoundary>
        </main>
      </div>
    </div>
  );
}
