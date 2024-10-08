import { Wallet } from "lucide-react";
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

export default function WalletDropDown() {
  const router = useRouter();
  const { wallets } = useUserWallets();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon" className="rounded-full">
          <Wallet className="h-5 w-5" />
          <span className="sr-only">Toggle wallet menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={async () => {
            router.push(`/`);
          }}
        >
          All Wallets
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {wallets &&
          wallets
            .filter((wallet) => !wallet.isArchived)
            .sort((a, b) =>
              a.isArchived === b.isArchived
                ? a.name.localeCompare(b.name)
                : a.isArchived
                  ? 1
                  : -1,
            )
            .map((wallet, i) => (
              <DropdownMenuItem
                key={i}
                onClick={async () => {
                  router.push(`/wallets/${wallet.id}`);
                }}
              >
                {wallet.name}
              </DropdownMenuItem>
            ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
