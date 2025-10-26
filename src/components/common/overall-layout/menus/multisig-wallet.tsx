import { Banknote, Info, List, Landmark, UserRoundPen, ChartNoAxesColumnIncreasing, FileCode2, ArrowLeft, ChevronDown, ChevronUp, Wallet2, Plus } from "lucide-react";
import { useRouter } from "next/router";
import { useState, useEffect } from "react";
import MenuLink from "./menu-link";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import useUserWallets from "@/hooks/useUserWallets";
import { Badge } from "@/components/ui/badge";
import { ChatBubbleIcon } from "@radix-ui/react-icons";
import usePendingSignables from "@/hooks/usePendingSignables";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import useAppWallet from "@/hooks/useAppWallet";
import WalletNavLink from "@/components/common/overall-layout/wallet-nav-link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function MenuWallet() {
  const router = useRouter();
  const baseUrl = `/wallets/${router.query.wallet as string | undefined}/`;
  const { wallets } = useUserWallets();
  const { appWallet } = useAppWallet();
  const { transactions } = usePendingTransactions();
  const { signables } = usePendingSignables();
  const { multisigWallet } = useMultisigWallet();
  const [open, setOpen] = useState(false);

  // Close dropdown on route change
  useEffect(() => {
    const handleRouteChange = () => {
      setOpen(false);
    };
    router.events.on("routeChangeStart", handleRouteChange);
    return () => {
      router.events.off("routeChangeStart", handleRouteChange);
    };
  }, [router.events]);

  if (!wallets) return;

  return (
    <nav className="grid h-full items-start px-2 font-medium lg:px-4">
      <div className="grid items-start space-y-1">
        {/* Wallet Selector */}
        <div className="mb-2">
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
              <button type="button" className="flex w-full max-w-[224px] lg:max-w-[228px] items-center gap-3 rounded-md px-3 py-2 transition-all duration-200 bg-white/80 dark:bg-gray-900/50 backdrop-blur-[10px] border border-gray-200/20 dark:border-white/10 text-muted-foreground hover:bg-gray-100/90 dark:hover:bg-gray-900/60 hover:text-foreground">
                <Wallet2 className="h-5 w-5 flex-shrink-0" />
                <span className="truncate">{appWallet?.name || "Select Wallet"}</span>
                {open ? (
                  <ChevronUp className="h-5 w-5 flex-shrink-0 ml-auto" />
                ) : (
                  <ChevronDown className="h-5 w-5 flex-shrink-0 ml-auto" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
              {wallets
                .filter((wallet) => !wallet.isArchived)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((wallet) => (
                  <DropdownMenuItem asChild key={wallet.id}>
                    <WalletNavLink wallet={wallet} />
                  </DropdownMenuItem>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    void router.push("/wallets/new-wallet-flow/save");
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-base text-muted-foreground transition-all duration-200 hover:bg-gray-100/50 dark:hover:bg-white/5 hover:text-foreground cursor-pointer"
                >
                  <Plus className="h-5 w-5 flex-shrink-0" />
                  <span>New Wallet</span>
                </button>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <MenuLink
          href={`${baseUrl}`}
          className={
            router.pathname == "/wallets/[wallet]" || router.pathname == "/wallets/[wallet]/info" ? "text-white" : ""
          }
        >
          <Info className="h-5 w-5" />
          Overview
        </MenuLink>
        <MenuLink
          href={`${baseUrl}assets`}
          className={
            router.pathname == "/wallets/[wallet]/assets" ? "text-white" : ""
          }
        >
          <Banknote className="h-5 w-5" />
          Assets
        </MenuLink>
        <MenuLink
          href={`${baseUrl}signing`}
          className={
            router.pathname == "/wallets/[wallet]/signing" ? "text-white" : ""
          }
        >
          <UserRoundPen className="h-5 w-5" />
          <span className="flex-1">Signing</span>
          {signables && signables.length > 0 && (
            <Badge className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full">
              {signables.length}
            </Badge>
          )}
        </MenuLink>
        <MenuLink
          href={`${baseUrl}transactions`}
          className={
            router.pathname == "/wallets/[wallet]/transactions"
              ? "text-white"
              : ""
          }
        >
          <List className="h-5 w-5" />
          <span className="flex-1">Transactions</span>
          {transactions && transactions.length > 0 && (
            <Badge className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full">
              {transactions.length}
            </Badge>
          )}
        </MenuLink>
        <MenuLink
          href={`${baseUrl}chat`}
          className={
            router.pathname == "/wallets/[wallet]/chat" ? "text-white" : ""
          }
        >
          <ChatBubbleIcon className="h-5 w-5" />
          Chat
        </MenuLink>
        {multisigWallet && multisigWallet.stakingEnabled() && <MenuLink
          href={`${baseUrl}staking`}
          className={
            router.pathname == "/wallets/[wallet]/staking" ? "text-white" : ""
          }
        >
          <ChartNoAxesColumnIncreasing className="h-5 w-5" />
          Staking
        </MenuLink>}
        <MenuLink
          href={`${baseUrl}governance`}
          className={
            router.pathname == "/wallets/[wallet]/governance" ? "text-white" : ""
          }
        >
          <Landmark className="h-5 w-5" />
          Governance
        </MenuLink>
        <MenuLink
          href={`${baseUrl}dapps`}
          className={
            router.pathname == "/wallets/[wallet]/dapps" ? "text-white" : ""
          }
        >
          <FileCode2 className="h-5 w-5" />
          Dapps
        </MenuLink>

        {/* Back to All Wallets */}
        <div className="mt-2 pt-2 border-t border-gray-200/30 dark:border-white/[0.03]">
          <MenuLink href={`/`}>
            <ArrowLeft className="h-5 w-5" />
            All Wallets
          </MenuLink>
        </div>
      </div>
    </nav>
  );
}
