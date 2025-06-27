import { ChevronDown, ChevronUp, Plus, Wallet2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRouter } from "next/router";
import useUserWallets from "@/hooks/useUserWallets";
import useAppWallet from "@/hooks/useAppWallet";
import { useState, useEffect } from "react";
import WalletNavLink from "./wallet-nav-link";

export default function WalletDropDown() {
  const router = useRouter();
  const { wallets } = useUserWallets();
  const { appWallet } = useAppWallet();
  const [open, setOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  // Check if desktop (with sidebar)
  useEffect(() => {
    const checkScreenSize = () => {
      setIsDesktop(window.innerWidth >= 768); // md breakpoint
    };
    
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // Close the dropdown when a route change starts
  useEffect(() => {
    const handleRouteChange = () => {
      setOpen(false);
    };

    router.events.on("routeChangeStart", handleRouteChange);
    return () => {
      router.events.off("routeChangeStart", handleRouteChange);
    };
  }, [router.events]);

  return isDesktop ? (
    // Desktop: Select-Button als Trigger (Option 1)
    <div className="inline-flex items-center rounded-md border border-border overflow-hidden h-10">
      <button
        type="button"
        className="flex items-center px-3 h-full text-muted-foreground hover:text-foreground hover:bg-muted border-r border-border"
        onClick={() => router.push("/wallets/new-wallet-flow/save")}
      >
        <Plus className="h-5 w-5" />
      </button>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="flex items-center rounded-none px-3 h-full hover:bg-muted"
          >
            {open ? (
              <ChevronUp className="h-5 w-5" />
            ) : (
              <ChevronDown className="h-5 w-5" />
            )}
            <span className="flex items-center ml-2">
              {appWallet?.name || "Select Wallet"}
            </span>
            <Wallet2 className="mx-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="mt-2 p-2">
          <DropdownMenuItem
            onSelect={() => setOpen(false)}
            onClick={() => router.push("/")}
          >
            All Wallets
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {wallets &&
            wallets
              .filter((wallet) => !wallet.isArchived)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((wallet) => (
                <DropdownMenuItem asChild key={wallet.id}>
                  <WalletNavLink wallet={wallet} />
                </DropdownMenuItem>
              ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ) : (
    // Mobile: Ganzer Container als Trigger (Option 2)
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <div className="inline-flex items-center rounded-md border border-border overflow-hidden h-10">
          <button
            type="button"
            className="flex items-center px-3 h-full text-muted-foreground hover:text-foreground hover:bg-muted border-r border-border"
            onClick={(e) => {
              e.stopPropagation();
              router.push("/wallets/new-wallet-flow/save");
            }}
          >
            <Plus className="h-5 w-5" />
          </button>
          <div className="flex items-center px-3 h-full hover:bg-muted cursor-pointer">
            {open ? (
              <ChevronUp className="h-5 w-5" />
            ) : (
              <ChevronDown className="h-5 w-5" />
            )}
            <span className="flex items-center ml-2">
              {appWallet?.name || "Select Wallet"}
            </span>
            <Wallet2 className="mx-2 h-4 w-4" />
          </div>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent 
        align="center" 
        className="mt-2 p-2 mx-4 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuItem
          onSelect={() => setOpen(false)}
          onClick={() => router.push("/")}
        >
          All Wallets
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {wallets &&
          wallets
            .filter((wallet) => !wallet.isArchived)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((wallet) => (
              <DropdownMenuItem asChild key={wallet.id}>
                <WalletNavLink wallet={wallet} />
              </DropdownMenuItem>
            ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}