import React, { useEffect, useRef, Component, ReactNode } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useNostrChat } from "@jinglescode/nostr-chat-plugin";
import { useWallet } from "@meshsdk/react";
import { publicRoutes } from "@/data/public-routes";
import { api } from "@/utils/api";
import useUser from "@/hooks/useUser";
import { useUserStore } from "@/lib/zustand/user";
import useAppWallet from "@/hooks/useAppWallet";

import SessionProvider from "@/components/SessionProvider";
import { getServerSession } from "next-auth";

// import MenuWallets from "@/components/common/overall-layout/menus/wallets";
import MenuWallet from "@/components/common/overall-layout/menus/multisig-wallet";
import {
  WalletDataLoaderWrapper,
  DialogReportWrapper,
  UserDropDownWrapper,
} from "@/components/common/overall-layout/mobile-wrappers";
import LogoutWrapper from "@/components/common/overall-layout/mobile-wrappers/logout-wrapper";
import { PageHomepage } from "@/components/pages/homepage";
import Logo from "@/components/common/overall-layout/logo";
import ConnectWallet from "@/components/common/cardano-objects/connect-wallet";
import Loading from "@/components/common/overall-layout/loading";
import { MobileNavigation } from "@/components/ui/mobile-navigation";
import { MobileActionsMenu } from "@/components/ui/mobile-actions-menu";

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
  const { user, isLoading } = useUser();
  const router = useRouter();
  const { appWallet } = useAppWallet();
  const { generateNsec } = useNostrChat();

  const userAddress = useUserStore((state) => state.userAddress);
  const setUserAddress = useUserStore((state) => state.setUserAddress);
  const ctx = api.useUtils();
  const initializingWalletRef = useRef(false);
  const lastInitializedWalletRef = useRef<string | null>(null);

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

  // Single effect for address + user creation
  useEffect(() => {
    (async () => {
      if (!connected || !wallet) return;

      // Don't run if user is already loaded (to avoid unnecessary re-runs)
      if (user) return;

      // Prevent multiple simultaneous initializations
      if (initializingWalletRef.current) {
        console.log("Layout: Wallet initialization already in progress, skipping...");
        return;
      }

      // Skip if we've already initialized this wallet and have userAddress
      if (userAddress && lastInitializedWalletRef.current === userAddress) {
        console.log("Layout: Wallet already initialized, skipping");
        return;
      }

      initializingWalletRef.current = true;

      try {
        console.log("Layout: Starting wallet initialization");
        
        // 1) Set user address in store
        let address: string | undefined;
        try {
          const usedAddresses = await wallet.getUsedAddresses();
          address = usedAddresses[0];
        } catch (e) {
          // If used addresses fail, try unused addresses
          try {
            const unusedAddresses = await wallet.getUnusedAddresses();
            address = unusedAddresses[0];
          } catch (e2) {
            console.error("Layout: Could not get addresses:", e2);
            initializingWalletRef.current = false;
            return;
          }
        }

        if (address) {
          console.log("Layout: Setting user address:", address);
          setUserAddress(address);
          lastInitializedWalletRef.current = address;
        } else {
          console.error("Layout: No address found from wallet");
          initializingWalletRef.current = false;
          return;
        }

        // 2) Get stake address
        const stakeAddress = (await wallet.getRewardAddresses())[0];
        if (!stakeAddress || !address) {
          console.error("Layout: No stake address or payment address found");
          return;
        }

        // 3) Get DRep key hash (optional)
        let drepKeyHash = "";
        try {
          const dRepKey = await wallet.getDRep();
          if (dRepKey && dRepKey.publicKeyHash) {
            drepKeyHash = dRepKey.publicKeyHash;
          }
        } catch (error) {
          // DRep key is optional, so we can ignore errors
        }

        // 4) Create or update user (upsert pattern handles both cases)
        // Remove the isLoading check - we should create user regardless
        console.log("Layout: Creating/updating user");
        const nostrKey = generateNsec();
        createUser({
          address,
          stakeAddress,
          drepKeyHash,
          nostrKey: JSON.stringify(nostrKey),
        });
        console.log("Layout: Wallet initialization completed successfully");
      } catch (error) {
        console.error("Layout: Error in wallet initialization effect:", error);
        
        // If we get an "account changed" error, reload the page
        if (error instanceof Error && error.message.includes("account changed")) {
          console.log("Layout: Account changed detected, reloading page...");
          window.location.reload();
          return;
        }

        // If rate limited, wait before allowing retry
        if (error instanceof Error && error.message.includes("too many requests")) {
          console.warn("Layout: Rate limit hit, will retry after delay");
          setTimeout(() => {
            initializingWalletRef.current = false;
          }, 5000);
          return;
        }
        
        // For other errors, reset so we can retry
        initializingWalletRef.current = false;
      } finally {
        // Reset if not rate limited (rate limit errors return early)
        if (initializingWalletRef.current) {
          initializingWalletRef.current = false;
        }
      }
    })();
  }, [connected, wallet, user, userAddress, createUser, generateNsec, setUserAddress]);

  const isWalletPath = router.pathname.includes("/wallets/[wallet]");
  const walletPageRoute = router.pathname.split("/wallets/[wallet]/")[1];
  const walletPageNames = walletPageRoute ? walletPageRoute.split("/") : [];
  const pageIsPublic = publicRoutes.includes(router.pathname);
  const isLoggedIn = !!user;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      {isLoading && <Loading />}

      {/* Header - full width, always on top */}
      <header
        className="pointer-events-auto relative z-[100] border-b border-gray-300/50 bg-muted/40 pl-2 pr-4 dark:border-white/[0.03] lg:pl-4 lg:pr-6"
        data-header="main"
      >
          <div className="flex h-14 items-center gap-4 lg:h-16">
            {/* Mobile menu button - only in wallet context */}
            {isWalletPath && <MobileNavigation isWalletPath={isWalletPath} />}

            {/* Logo - in fixed-width container matching sidebar width */}
            <div className={`flex items-center md:w-[260px] lg:w-[280px] ${isWalletPath ? 'flex-1 justify-center md:flex-none md:justify-start' : ''}`}>
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
                <ConnectWallet />
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
      <div className={`flex flex-1 overflow-hidden ${isWalletPath ? '' : ''}`}>
        {/* Sidebar for larger screens - only in wallet context */}
        {isWalletPath && (
          <aside className="hidden w-[260px] border-r border-gray-300/50 bg-muted/40 dark:border-white/[0.03] md:block lg:w-[280px]">
            <div className="flex h-full max-h-screen flex-col">
              <nav className="flex-1 pt-2">
                <MenuWallet />
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
