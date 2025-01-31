import { Badge } from "@/components/ui/badge";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import useUser from "@/hooks/useUser";
import useUserWallets from "@/hooks/useUserWallets";
import { Wallet } from "@prisma/client";
import { Plus, Wallet2, House, Sparkle, Scale } from "lucide-react";
import MenuLink from "./menu-link";
import { useRouter } from "next/router";

export default function MenuWallets() {
  const { user } = useUser();
  const { wallets } = useUserWallets();
  const isLoggedIn = user !== undefined && user !== null;
  const router = useRouter();
  const baseUrl = `/wallets/${router.query.wallet as string | undefined}/`;

  return (
    <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
      <MenuLink
        href={`/`}
        className={router.pathname == "/" ? "text-white" : ""}
      >
        <House className="h-4 w-4" />
        <div className="flex items-center gap-2">Home</div>
      </MenuLink>
      <MenuLink
        href={
          router.pathname.startsWith("/wallets/[wallet]")
            ? `${baseUrl}governance`
            : "/governance"
        }
        className={
          router.pathname.includes('governance') ? "text-white" : ""
        }
      >
        <Scale className="h-4 w-4" />
        Governance
      </MenuLink>
      <MenuLink
        href={`/features`}
        className={router.pathname == "/features" ? "text-white" : ""}
      >
        <Sparkle className="h-4 w-4" />
        <div className="flex items-center gap-2">Features</div>
      </MenuLink>

      <br />

      {isLoggedIn && (<p>Multi-Sig Wallets:</p>)}

      {wallets &&
        wallets
          .sort((a, b) =>
            a.isArchived === b.isArchived
              ? a.name.localeCompare(b.name)
              : a.isArchived
                ? 1
                : -1,
          )
          .map((wallet) => <WalletNavLink key={wallet.id} wallet={wallet} />)}
      {isLoggedIn && (
        <MenuLink href={`/wallets/new-wallet`}>
          <Plus className="h-4 w-4" />
          New Wallet
        </MenuLink>
      )}

      <br />
    </nav>
  );

  function WalletNavLink({ wallet }: { wallet: Wallet }) {
    const { transactions } = usePendingTransactions({ walletId: wallet.id });
    return (
      <MenuLink
        href={`/wallets/${wallet.id}`}
        className={
          router.pathname.startsWith("/wallets/[wallet]") &&
          router.query.wallet == wallet.id
            ? "text-white hover:text-gray-500"
            : ""
        }
      >
        <Wallet2 className="h-4 w-4" />
        {wallet.name}
        {wallet.isArchived && " (Archived)"}
        {transactions && transactions.length > 0 && (
          <Badge className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
            {transactions.length}
          </Badge>
        )}
      </MenuLink>
    );
  }
}
