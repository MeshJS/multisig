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
import { useState } from "react";
import WalletNavLink from "./wallet-nav-link";

export default function WalletDropDown() {
  const router = useRouter();
  const { wallets } = useUserWallets();
  const { appWallet } = useAppWallet();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center rounded-md border border-secondary border-border">
      <button
        type="button"
        className="flex items-center px-2 text-muted-foreground hover:text-foreground"
        onClick={() => router.push("/wallets/new-wallet")}
      >
        <Plus className="h-5 w-5" />
      </button>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="flex items-center rounded-none border-r border-border"
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
        <DropdownMenuContent align="end" className="mt-2 p-2">
          <DropdownMenuItem onClick={() => router.push("/")}>
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
  );
}
