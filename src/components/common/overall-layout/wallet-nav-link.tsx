import { Wallet2 } from "lucide-react";
import { useRouter } from "next/router";
import { Badge } from "@/components/ui/badge";
import MenuLink from "./menus/menu-link";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import { Wallet } from "@prisma/client";

export default function WalletNavLink({ wallet }: { wallet: Wallet }) {
  const { pathname, query } = useRouter();
  const { transactions } = usePendingTransactions({ walletId: wallet.id });
  const isActive =
    pathname.startsWith("/wallets/[wallet]") && query.wallet === wallet.id;

  return (
    <MenuLink
      href={`/wallets/${wallet.id}`}
      className={`border-x px-4 py-2 ${
        isActive
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:border-secondary"
      } `}
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