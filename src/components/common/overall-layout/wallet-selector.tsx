import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { ChevronDown, ChevronUp, Wallet2, Plus, House } from "lucide-react";
import useUserWallets from "@/hooks/useUserWallets";
import useAppWallet from "@/hooks/useAppWallet";
import WalletNavLink from "@/components/common/overall-layout/wallet-nav-link";
import MenuLink from "@/components/common/overall-layout/menus/menu-link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface WalletSelectorProps {
  fallbackWalletName?: string | null;
  onClearWallet?: () => void;
}

export default function WalletSelector({ fallbackWalletName, onClearWallet }: WalletSelectorProps = {}) {
  const router = useRouter();
  const { wallets } = useUserWallets();
  const { appWallet } = useAppWallet();
  const [open, setOpen] = useState(false);

  const displayName = appWallet?.name || fallbackWalletName || "Select Wallet";

  const handleHomeClick = () => {
    if (onClearWallet) {
      onClearWallet();
    }
    void router.push("/");
  };

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

  if (!wallets) return null;

  return (
    <div className="grid items-start px-2 font-medium lg:px-4">
      <div className="grid items-start space-y-1">
        {/* Wallet Selector */}
        <div className="mt-1 mb-1">
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex w-full max-w-[244px] lg:max-w-[248px] items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-200 bg-white dark:bg-zinc-900 border border-zinc-300/40 dark:border-white/10 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-foreground"
              >
                <Wallet2 className="h-5 w-5 flex-shrink-0" />
                <span className="truncate">{displayName}</span>
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
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-all duration-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-foreground cursor-pointer"
                >
                  <Plus className="h-5 w-5 flex-shrink-0" />
                  <span>New Wallet</span>
                </button>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Home Link */}
        <div className="mt-1 pt-1 space-y-1">
          <button
            onClick={handleHomeClick}
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-200 hover:bg-gray-100/50 dark:hover:bg-white/5 ${
              router.pathname === "/" ||
              (router.pathname === "/wallets" || (router.pathname.startsWith("/wallets/") && !router.pathname.startsWith("/wallets/[wallet]")))
                ? "!bg-gray-900 dark:!bg-white/10 !text-white dark:!text-white !font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <House className="h-5 w-5" />
            <div className="flex items-center gap-2">Home</div>
          </button>
        </div>
      </div>
    </div>
  );
}
