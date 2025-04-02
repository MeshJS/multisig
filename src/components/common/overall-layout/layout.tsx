import React, { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/utils/api";
import ConnectWallet from "../cardano-objects/connect-wallet";
import { useWallet } from "@meshsdk/react";
import UserDropDown from "./user-drop-down";
import useUser from "@/hooks/useUser";
import { useUserStore } from "@/lib/zustand/user";
import MenuWallets from "./menus/wallets";
import MenuWallet from "./menus/wallet";
import useAppWallet from "@/hooks/useAppWallet";
import WalletDropDown from "./wallet-drop-down";
import { PageHomepage } from "@/components/pages/homepage";
import WalletDataLoader from "./wallet-data-loader";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import Logo from "./logo";
import { useNostrChat } from "@jinglescode/nostr-chat-plugin";
import { publicRoutes } from "@/data/public-routes";
import Loading from "./loading";
import DialogReport from "./dialog-report";
import { useRouter } from "next/router";
import { Menu as MenuIcon } from "lucide-react";

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
    <div className="grid h-screen w-full overflow-hidden md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      {isLoading && <Loading />}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-30 flex">
          <div className="w-64 bg-muted p-4">
            <button className="mb-4" onClick={() => setMobileMenuOpen(false)}>Close</button>
            <MenuWallets />
            {router.pathname.includes("/wallets/[wallet]") && <MenuWallet />}
          </div>
          <div className="flex-1 bg-black opacity-50" onClick={() => setMobileMenuOpen(false)}></div>
        </div>
      )}

      {/* Sidebar for larger screens */}
      <aside className="hidden border-r bg-muted/40 md:block">
        <div className="flex h-full max-h-screen flex-col gap-2">
          <header className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <Logo />
              <span>Multi-Sig Platform</span>
            </Link>
          </header>
          <nav className="flex-1">
            <MenuWallets />
            {isWalletPath && <MenuWallet />}
          </nav>
          <div className="mt-auto p-4" />
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex h-screen flex-col">
        <header className="pointer-events-auto relative z-10 border-b bg-muted/40 px-4 lg:px-6">
          <div className="flex h-14 items-center gap-4 lg:h-[60px]">
            <button className="md:hidden" onClick={() => setMobileMenuOpen(true)}>
              <MenuIcon className="h-6 w-6" />
            </button>
            {/* Wallet selection + breadcrumb row */}
            {isLoggedIn && (
              <div className="border-t border-border">
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
                  <WalletDataLoader />
                  <DialogReport />
                  <UserDropDown />
                </>
              )}
            </div>
          </div>
        </header>

        <main className="relative flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-8">
          {pageIsPublic || userAddress ? children : <PageHomepage />}
        </main>
      </div>
    </div>
  );
}
