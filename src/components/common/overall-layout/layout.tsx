import React, { useEffect } from "react";
import Link from "next/link";
import { Menu, Plus, Wallet2 } from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
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
import MenuLink from "./menus/menu-link";
import { Badge } from "@/components/ui/badge";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import useUserWallets from "@/hooks/useUserWallets";
import { useRouter } from "next/router";
import { Wallet } from "@prisma/client";

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
  const { wallets } = useUserWallets();

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
            {/* Mobile menu */}
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0 md:hidden"
                >
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Toggle navigation menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex flex-col">
                <nav className="grid gap-2 text-lg font-medium">
                  {/* Mobile navigation can go here */}
                </nav>
              </SheetContent>
            </Sheet>

            {/* Wallet selection + breadcrumb row */}
            {isLoggedIn && (
              <div className="border-t border-border">
                <div className="mx-auto w-full max-w-screen-xl px-4 py-2">
                  <nav className="flex items-center justify-between">
                    {/* Left: New Wallet button */}
                    <div className="flex-shrink-0">
                      <MenuLink
                        href="/wallets/new-wallet"
                        className="flex items-center gap-1 border-b-2 border-transparent px-4 py-2 hover:text-primary"
                      >
                        <Plus className="h-4 w-4" />
                        New Wallet
                      </MenuLink>
                    </div>

                    {/* Center: Wallet selection (limited width with horizontal scrolling) */}
                    <div
                      className="mx-4 w-full max-w-[500px] overflow-x-auto whitespace-nowrap rounded-lg border-x-2 border-primary text-primary"
                      style={{
                        scrollbarWidth: "none",
                        msOverflowStyle: "none",
                      }}
                      onWheel={(e) => {
                        if (e.deltaY === 0) return;
                        e.currentTarget.scrollLeft += e.deltaY;
                      }}
                    >
                      <div className="flex items-center space-x-4 [&::-webkit-scrollbar]:hidden">
                        {wallets &&
                          wallets
                            .filter((w) => !w.isArchived)
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((w) => (
                              <WalletNavLink key={w.id} wallet={w} />
                            ))}
                      </div>
                    </div>

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
                  <WalletDropDown />
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

/** Single wallet nav tab. */
function WalletNavLink({ wallet }: { wallet: Wallet }) {
  const { pathname, query } = useRouter();
  const { transactions } = usePendingTransactions({ walletId: wallet.id });
  const isActive =
    pathname.startsWith("/wallets/[wallet]") && query.wallet === wallet.id;

  return (
    <MenuLink
      href={`/wallets/${wallet.id}`}
      className={`border-b-2 px-4 py-2 ${
        isActive
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground"
      } hover:text-primary`}
    >
      <Wallet2 className="mr-1 h-4 w-4" />
      {wallet.name}
      {wallet.isArchived && " (Archived)"}
      {transactions && transactions.length > 0 && (
        <Badge className="ml-2 flex h-6 w-6 items-center justify-center rounded-full">
          {transactions.length}
        </Badge>
      )}
    </MenuLink>
  );
}
