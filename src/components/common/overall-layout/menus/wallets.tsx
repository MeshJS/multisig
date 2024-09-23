import { Badge } from "@/components/ui/badge";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import useUser from "@/hooks/useUser";
import useUserWallets from "@/hooks/useUserWallets";
import { Wallet } from "@prisma/client";
import { Plus, Wallet2 } from "lucide-react";
import MenuLink from "./menu-link";

export default function MenuWallets() {
  const { user } = useUser();
  const { wallets } = useUserWallets();
  const isLoggedIn = user !== undefined && user !== null;

  return (
    <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
      {wallets &&
        wallets.map((wallet) => (
          <WalletNavLink key={wallet.id} wallet={wallet} />
        ))}
      {isLoggedIn && (
        <MenuLink href={`/wallets/new-wallet`}>
          <Plus className="h-4 w-4" />
          New Wallet
        </MenuLink>
      )}
    </nav>
  );
}

function WalletNavLink({ wallet }: { wallet: Wallet }) {
  const { transactions } = usePendingTransactions({ walletId: wallet.id });
  return (
    <MenuLink href={`/wallets/${wallet.id}`}>
      <Wallet2 className="h-4 w-4" />
      {wallet.name}
      {transactions && transactions.length > 0 && (
        <Badge className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
          {transactions.length}
        </Badge>
      )}
    </MenuLink>
  );
}
