import React from "react";
import { Wallet2 } from "lucide-react";
import { useRouter } from "next/router";
import { Badge } from "@/components/ui/badge";
import MenuLink from "./menus/menu-link";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import { Wallet } from "@prisma/client";

type WalletNavLinkProps = {
  wallet: Wallet;
};

const WalletNavLink = React.forwardRef<HTMLSpanElement, WalletNavLinkProps>(
  ({ wallet }, ref) => {
    const { pathname, query } = useRouter();
    const { transactions } = usePendingTransactions({ walletId: wallet.id });
    const isActive =
      pathname.startsWith("/wallets/[wallet]") && query.wallet === wallet.id;

    return (
      <span ref={ref} className="block">
        <MenuLink
          href={`/wallets/${wallet.id}`}
          className={`${
            isActive
              ? "text-white"
              : ""
          }`}
        >
          <Wallet2 className="h-5 w-5 flex-shrink-0" />
          <span className="flex-1 min-w-0 truncate">
            {wallet.name}
            {wallet.isArchived && " (Archived)"}
          </span>
          {transactions && transactions.length > 0 && (
            <Badge className="flex h-4 w-4 items-center justify-center rounded-full flex-shrink-0">
              {transactions.length}
            </Badge>
          )}
        </MenuLink>
      </span>
    );
  }
);

WalletNavLink.displayName = "WalletNavLink";
export default WalletNavLink;