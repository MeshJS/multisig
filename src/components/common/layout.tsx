import Link from "next/link";
import { Menu, Plus, Wallet2 } from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import React, { useEffect } from "react";
import ConnectWallet from "./connect-wallet";
import { useWallet } from "@meshsdk/react";
import UserDropDown from "./user-drop-down";
import useUser from "@/hooks/useUser";
import { useUserStore } from "@/lib/zustand/user";
import { checkSignature, generateNonce } from "@meshsdk/core";
import { Badge } from "../ui/badge";
import useUserWallets from "@/hooks/useUserWallets";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import { Wallet } from "@prisma/client";
import { PageHomepage } from "../pages/homepage";
import { useRouter } from "next/router";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { connected, wallet } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const setUserAddress = useUserStore((state) => state.setUserAddress);
  const { user, isLoading } = useUser();
  const { wallets } = useUserWallets();

  const { mutate: createUser } = api.user.createUser.useMutation({
    // onSuccess: async () => {},
    onError: (e) => {
      console.error(e);
    },
  });

  /**
   * Fetch the user address when the wallet is connected, and set to the store
   */
  useEffect(() => {
    async function load() {
      if (connected) {
        const userAddress = (await wallet.getUsedAddresses())[0];
        setUserAddress(userAddress);
      }
    }
    load();
  }, [connected]);

  /**
   * Create a user when the user is not created
   */
  useEffect(() => {
    async function load() {
      if (isLoading === false && user === null) {
        const userStakeAddress = (await wallet.getRewardAddresses())[0];
        const userAddress = (await wallet.getUsedAddresses())[0];

        if (userStakeAddress === undefined || userAddress === undefined)
          throw new Error("User address is undefined");

        const nonce = generateNonce(
          "I agree to the terms and conditions of Multi-sig Platform. ",
        );
        const signature = await wallet.signData(nonce, userStakeAddress);
        const result = checkSignature(nonce, signature);

        if (result) {
          createUser({ address: userAddress, stakeAddress: userStakeAddress });
        }
      }
    }
    load();
  }, [user, isLoading]);

  const isLoggedIn = user !== undefined && user !== null;

  return (
    <div className="grid h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      <div className="hidden border-r bg-muted/40 md:block">
        <div className="flex h-full max-h-screen flex-col gap-2">
          <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <Wallet2 className="h-6 w-6" />
              <span className="">Multi-Sig Platform</span>
            </Link>
            {/* <Button variant="outline" size="icon" className="ml-auto h-8 w-8">
              <Bell className="h-4 w-4" />
              <span className="sr-only">Toggle notifications</span>
            </Button> */}
          </div>
          <div className="flex-1">
            <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
              {wallets &&
                wallets.map((wallet) => (
                  <WalletNavLink key={wallet.id} wallet={wallet} />
                ))}
              {isLoggedIn && (
                <Link
                  href={`/wallets/new-wallet`}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary"
                >
                  <Plus className="h-4 w-4" />
                  New Wallet
                </Link>
              )}
            </nav>
          </div>
          <div className="mt-auto p-4"></div>
        </div>
      </div>
      <div className="flex h-[calc(100vh)] flex-col">
        <header className="flex h-14 items-center gap-4 border-b bg-muted/40 px-4 lg:h-[60px] lg:px-6">
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
                {/* <Link
                  href="#"
                  className="flex items-center gap-2 text-lg font-semibold"
                >
                  <Wallet2 className="h-6 w-6" />
                </Link>
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.path}
                    href={`${link.path}`}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-muted-foreground hover:text-primary"
                  >
                    {React.createElement(link.icon, { className: "h-5 w-5" })}
                    {link.label}
                  </Link>
                ))}
                <Link
                  href="/transactions"
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary"
                >
                  <List className="h-4 w-4" />
                  Transactions
                  <Badge className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
                    6
                  </Badge>
                </Link> */}
              </nav>
              <div className="mt-auto"></div>
            </SheetContent>
          </Sheet>
          <div className="w-full flex-1"></div>
          {!connected ? <ConnectWallet /> : <UserDropDown />}
        </header>
        <main className="flex h-full flex-1 flex-col gap-4 overflow-y-auto p-4 lg:gap-6 lg:p-6">
          {userAddress === undefined ? <PageHomepage /> : children}
        </main>
      </div>
    </div>
  );
}

function WalletNavLink({ wallet }: { wallet: Wallet }) {
  const { transactions } = usePendingTransactions({ walletId: wallet.id });

  return (
    <Link
      href={`/wallets/${wallet.id}`}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary"
    >
      <Wallet2 className="h-4 w-4" />
      {wallet.name}
      {transactions && transactions.length > 0 && (
        <Badge className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
          {transactions.length}
        </Badge>
      )}
    </Link>
  );
}
