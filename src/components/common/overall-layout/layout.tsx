import React, { useEffect, Component, ReactNode } from "react";
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
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

// Enhanced error boundary component for wallet errors
class WalletErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; falflback: ReactNode }) {
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
    onError: (e) => console.error(e),
  });
  const { mutate: updateUser } = api.user.updateUser.useMutation({
    onError: (e) => console.error(e),
  });

  // Single effect for address + user creation
  useEffect(() => {
    (async () => {
      if (!connected || !wallet) return;

      try {
        // 1) Set user address in store
        let address = (await wallet.getUsedAddresses())[0];
        if (!address) address = (await wallet.getUnusedAddresses())[0];
        if (address) setUserAddress(address);

        // 2) Get stake address
        const stakeAddress = (await wallet.getRewardAddresses())[0];
        if (!stakeAddress || !address) {
          console.error("No stake address or payment address found");
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
        }

        // 4) Create or update user (upsert pattern handles both cases)
        if (!isLoading) {
          const nostrKey = generateNsec();
          createUser({
            address,
            stakeAddress,
            drepKeyHash,
            nostrKey: JSON.stringify(nostrKey),
          });
        }
      } catch (error) {
        console.error("Error in wallet initialization effect:", error);
        
        // If we get an "account changed" error, reload the page
        if (error instanceof Error && error.message.includes("account changed")) {
          console.log("Account changed detected, reloading page...");
          window.location.reload();
          return;
        }
        
        // For other errors, don't throw to prevent app crash
        // The user can retry by reconnecting their wallet
      }
    })();
  }, [connected, wallet, user, isLoading, createUser, generateNsec, setUserAddress]);

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
        className="pointer-events-auto relative z-10 border-b border-gray-200/30 bg-muted/40 px-2 dark:border-white/[0.03] lg:px-4"
        data-header="main"
      >
          <div className="flex h-14 items-center gap-4 lg:h-16">
            {/* Mobile menu button - only in wallet context */}
            {isWalletPath && <MobileNavigation isWalletPath={isWalletPath} />}

            {/* Logo - in fixed-width container matching sidebar width */}
            <div className={`flex items-center md:-ml-2 md:pl-2 md:w-[240px] lg:-ml-4 lg:pl-4 lg:w-[260px] ${isWalletPath ? 'flex-1 justify-center md:flex-none md:justify-start' : ''}`}>
              <Link
                href="/"
                className="flex items-center gap-3 rounded-md px-3 py-2 transition-all duration-200 hover:bg-gray-100/50 dark:hover:bg-white/5"
              >
                <Logo />
                <span className="select-none font-medium tracking-[-0.01em] text-sm md:text-base lg:text-lg">
                  Multisig Platform
                </span>
              </Link>
            </div>

            {/* Breadcrumb on desktop */}
            {isLoggedIn && isWalletPath && appWallet && (
              <div className="hidden md:block">
                <div className="ml-4 py-2">
                  <Breadcrumb>
                    <BreadcrumbList>
                      {walletPageNames.map((name, index) => (
                        <React.Fragment key={index}>
                          <BreadcrumbItem>
                            <BreadcrumbLink asChild>
                              <Link
                                href={`/wallets/${appWallet.id}/${walletPageNames
                                  .slice(0, index + 1)
                                  .join("/")}`}
                              >
                                {name.toUpperCase()}
                              </Link>
                            </BreadcrumbLink>
                          </BreadcrumbItem>
                        </React.Fragment>
                      ))}
                    </BreadcrumbList>
                  </Breadcrumb>
                </div>
              </div>
            )}

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
          <aside className="hidden w-[240px] border-r border-gray-200/30 bg-muted/40 dark:border-white/[0.03] md:block lg:w-[260px]">
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
