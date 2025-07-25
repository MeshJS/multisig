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
          className={`border-x px-4 py-2 ${
            isActive
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:border-secondary"
          }`}
        >
          <div className="flex items-start gap-1">
            <Wallet2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="break-words">
                {wallet.name}
                {wallet.isArchived && " (Archived)"}
              </div>
            </div>
            {transactions && transactions.length > 0 && (
              <Badge className="ml-2 flex h-6 w-6 items-center justify-center rounded-full flex-shrink-0">
                {transactions.length}
              </Badge>
            )}
          </div>
        </MenuLink>
      </span>
    );
  }
);

WalletNavLink.displayName = "WalletNavLink";
export default WalletNavLink;