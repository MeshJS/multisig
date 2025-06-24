import React, { useEffect } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useNostrChat } from "@jinglescode/nostr-chat-plugin";
import { useWallet } from "@meshsdk/react";
import { publicRoutes } from "@/data/public-routes";
import { api } from "@/utils/api";
import useUser from "@/hooks/useUser";
import { useUserStore } from "@/lib/zustand/user";
import useAppWallet from "@/hooks/useAppWallet";

import MenuWallets from "@/components/common/overall-layout/menus/wallets";
import MenuWallet from "@/components/common/overall-layout/menus/multisig-wallet";
import WalletDropDown from "@/components/common/overall-layout/wallet-drop-down";
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

  const { mutate: createUser } = api.user.createUser.useMutation({
    onError: (e) => console.error(e),
  });

  // Single effect for address + user creation
  useEffect(() => {
    (async () => {
      if (!connected || !wallet) return;

      // 1) Set user address in store
      let address = (await wallet.getUsedAddresses())[0];
      if (!address) address = (await wallet.getUnusedAddresses())[0];
      if (address) setUserAddress(address);

      // 2) If user doesn't exist, create it
      if (!isLoading && user === null) {
        const stakeAddress = (await wallet.getRewardAddresses())[0];
        if (!stakeAddress || !address) {
          console.error("No stake address or payment address found");
          return;
        }
        const nostrKey = generateNsec();
        createUser({
          address,
          stakeAddress,
          nostrKey: JSON.stringify(nostrKey),
        });
      }
    })();
  }, [
    connected,
    wallet,
    user,
    isLoading,
    createUser,
    generateNsec,
    setUserAddress,
  ]);

  const isWalletPath = router.pathname.includes("/wallets/[wallet]");
  const walletPageRoute = router.pathname.split("/wallets/[wallet]/")[1];
  const walletPageNames = walletPageRoute ? walletPageRoute.split("/") : [];
  const pageIsPublic = publicRoutes.includes(router.pathname);
  const isLoggedIn = !!user;

  return (
    <div className="grid h-screen w-screen overflow-hidden md:grid-cols-[240px_1fr] lg:grid-cols-[260px_1fr]">
      {isLoading && <Loading />}

      {/* Sidebar for larger screens */}
      <aside className="hidden border-r border-gray-200/30 dark:border-white/[0.03] bg-muted/40 md:block">
        <div className="flex h-full max-h-screen flex-col">
          <header className="flex h-14 items-center border-b border-gray-200/30 dark:border-white/[0.03] px-4 lg:h-16 lg:px-6" id="logo-header" data-header="sidebar">
            <Link href="/" className="flex items-center gap-3">
              <Logo />
              <span className="font-medium text-sm md:text-base lg:text-lg tracking-[-0.01em] select-none">Multi-Sig Platform</span>
            </Link>
          </header>
          <nav className="flex-1 pt-2">
            <MenuWallets />
            {isWalletPath && <MenuWallet />}
          </nav>
          <div className="mt-auto p-4" />
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex h-screen flex-col">
        <header className="pointer-events-auto relative z-10 border-b border-gray-200/30 dark:border-white/[0.03] bg-muted/40 px-4 lg:px-6" data-header="main">
          <div className="flex h-14 items-center gap-4 lg:h-16">
            {/* Mobile menu button */}
            <MobileNavigation isWalletPath={isWalletPath} />
            
            {/* Wallet selection on mobile - centered */}
            {isLoggedIn && (
              <div className="flex-1 flex justify-center md:hidden">
                <WalletDropDown />
              </div>
            )}
            
            {/* Wallet selection + breadcrumb row on desktop */}
            {isLoggedIn && (
              <div className="hidden md:block">
                <div className="mx-1 w-full py-2">
                  <nav className="flex items-center">
                    <WalletDropDown />

                    {/* Right: Breadcrumb */}
                    <div className="flex-shrink-0">
                      {isWalletPath && appWallet ? (
                        <Breadcrumb>
                          <BreadcrumbList>
                            {walletPageNames.map((name, index) => (
                              <React.Fragment key={index}>
                                <BreadcrumbSeparator />
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
                      ) : (
                        <div className="w-40" /> /* Placeholder to keep right side spacing */
                      )}
                    </div>
                  </nav>
                </div>
              </div>
            )}

            {/* Right: Control buttons */}
            <div className="ml-auto flex items-center space-x-2">
              {!connected ? (
                <ConnectWallet />
              ) : (
                <>
                  {/* Desktop buttons */}
                  <div className="hidden md:flex items-center space-x-2">
                    <WalletDataLoaderWrapper mode="button" />
                    <DialogReportWrapper mode="button" />
                    <UserDropDownWrapper mode="button" />
                  </div>
                  {/* Mobile actions menu */}
                  <MobileActionsMenu>
                    <WalletDataLoaderWrapper mode="menu-item" />
                    <DialogReportWrapper mode="menu-item" />
                    <UserDropDownWrapper mode="menu-item" />
                    <div className="h-px bg-border -mx-2 my-1" />
                    <LogoutWrapper mode="menu-item" />
                  </MobileActionsMenu>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="relative flex flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden p-4 md:p-8">
          {pageIsPublic || userAddress ? children : <PageHomepage />}
        </main>
      </div>
    </div>
  );
}
