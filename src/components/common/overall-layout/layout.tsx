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

import SessionProvider from "@/components/SessionProvider";
import { getServerSession } from "next-auth";

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
  const { mutate: updateUser } = api.user.updateUser.useMutation({
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

      // 2) Get stake address
      const stakeAddress = (await wallet.getRewardAddresses())[0];
      if (!stakeAddress || !address) {
        console.error("No stake address or payment address found");
        return;
      }

      // 3) Get DRep key hash
      const dRepKey = await wallet.getDRep();
      if (!dRepKey) {
        console.error("No DRep key found");
        return;
      }
      const drepKeyHash = dRepKey.publicKeyHash;
      if (!drepKeyHash) {
        console.error("No DRep key hash found:", drepKeyHash);
        return;
      }

      // 4) If user doesn't exist create it
      if (!isLoading && user === null) {
        const nostrKey = generateNsec();
        createUser({
          address,
          stakeAddress,
          drepKeyHash,
          nostrKey: JSON.stringify(nostrKey),
        });
      }

      // 5) If user exists but missing fields, update it
      if (
        !isLoading &&
        user &&
        user !== null &&
        (user.stakeAddress !== stakeAddress || user.drepKeyHash !== drepKeyHash)
      ) {
        updateUser({
          address,
          stakeAddress,
          drepKeyHash,
        });
      }
    })();
  }, [connected, wallet, user, isLoading, generateNsec, setUserAddress]);

  const isWalletPath = router.pathname.includes("/wallets/[wallet]");
  const walletPageRoute = router.pathname.split("/wallets/[wallet]/")[1];
  const walletPageNames = walletPageRoute ? walletPageRoute.split("/") : [];
  const pageIsPublic = publicRoutes.includes(router.pathname);
  const isLoggedIn = !!user;

  return (
    <div className="grid h-screen w-screen overflow-hidden md:grid-cols-[240px_1fr] lg:grid-cols-[260px_1fr]">
      {isLoading && <Loading />}

      {/* Sidebar for larger screens */}
      <aside className="hidden border-r border-gray-200/30 bg-muted/40 dark:border-white/[0.03] md:block">
        <div className="flex h-full max-h-screen flex-col">
          <header
            className="flex h-14 items-center border-b border-gray-200/30 px-4 dark:border-white/[0.03] lg:h-16 lg:px-6"
            id="logo-header"
            data-header="sidebar"
          >
            <Link href="/" className="flex items-center gap-3">
              <Logo />
              <span className="select-none text-sm font-medium tracking-[-0.01em] md:text-base lg:text-lg">
                Multi-Sig Platform
              </span>
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
        <header
          className="pointer-events-auto relative z-10 border-b border-gray-200/30 bg-muted/40 px-4 dark:border-white/[0.03] lg:px-6"
          data-header="main"
        >
          <div className="flex h-14 items-center gap-4 lg:h-16">
            {/* Mobile menu button */}
            <MobileNavigation isWalletPath={isWalletPath} />

            {/* Logo in mobile header - centered */}
            <div className="flex flex-1 justify-center md:hidden">
              <Link
                href="/"
                className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-gray-100/50 dark:hover:bg-gray-800/50"
              >
                <svg
                  className="h-7 w-7 flex-shrink-0 text-foreground"
                  enableBackground="new 0 0 300 200"
                  viewBox="0 0 300 200"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="currentColor"
                >
                  <path d="m289 127-45-60-45-60c-.9-1.3-2.4-2-4-2s-3.1.7-4 2l-37 49.3c-2 2.7-6 2.7-8 0l-37-49.3c-.9-1.3-2.4-2-4-2s-3.1.7-4 2l-45 60-45 60c-1.3 1.8-1.3 4.2 0 6l45 60c.9 1.3 2.4 2 4 2s3.1-.7 4-2l37-49.3c2-2.7 6-2.7 8 0l37 49.3c.9 1.3 2.4 2 4 2s3.1-.7 4-2l37-49.3c2-2.7 6-2.7 8 0l37 49.3c.9 1.3 2.4 2 4 2s3.1-.7 4-2l45-60c1.3-1.8 1.3-4.2 0-6zm-90-103.3 32.5 43.3c1.3 1.8 1.3 4.2 0 6l-32.5 43.3c-2 2.7-6 2.7-8 0l-32.5-43.3c-1.3-1.8-1.3-4.2 0-6l32.5-43.3c2-2.7 6-2.7 8 0zm-90 0 32.5 43.3c1.3 1.8 1.3 4.2 0 6l-32.5 43.3c-2 2.7-6 2.7-8 0l-32.5-43.3c-1.3-1.8-1.3-4.2 0-6l32.5-43.3c2-2.7 6-2.7 8 0zm-53 152.6-32.5-43.3c-1.3-1.8-1.3-4.2 0-6l32.5-43.3c2-2.7 6-2.7 8 0l32.5 43.3c1.3 1.8 1.3 4.2 0 6l-32.5 43.3c-2 2.7-6 2.7-8 0zm90 0-32.5-43.3c-1.3-1.8-1.3-4.2 0-6l32.5-43.3c2-2.7 6-2.7 8 0l32.5 43.3c1.3 1.8 1.3 4.2 0 6l-32.5 43.3c-2 2.7-6 2.7-8 0zm90 0-32.5-43.3c-1.3-1.8-1.3-4.2 0-6l32.5-43.3c2-2.7 6-2.7 8 0l32.5 43.3c1.3 1.8 1.3 4.2 0 6l-32.5 43.3c-2 2.7-6 2.7-8 0z" />
                </svg>
                <span className="whitespace-nowrap text-base font-medium text-foreground">
                  Multi-Sig Platform
                </span>
              </Link>
            </div>

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

        <main className="relative flex flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden p-4 md:p-8">
          {pageIsPublic || userAddress ? children : <PageHomepage />}
        </main>
      </div>
    </div>
  );
}
