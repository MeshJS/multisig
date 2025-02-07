import { ArrowLeft, Info, List, Scale, Wallet } from "lucide-react";
import { useRouter } from "next/router";
import MenuLink from "./menu-link";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import useUserWallets from "@/hooks/useUserWallets";
import { Badge } from "@/components/ui/badge";
import { ChatBubbleIcon } from "@radix-ui/react-icons";

export default function MenuWallet() {
  const router = useRouter();
  const baseUrl = `/wallets/${router.query.wallet as string | undefined}/`;
  const { wallets } = useUserWallets();
  const { transactions } = usePendingTransactions();
  if(!wallets)return;
  return (
    <nav className="grid h-full items-start px-2 text-sm font-medium lg:px-4">
      <div className="grid items-start">
        <p>{wallets.filter((wallet) => wallet.id === router.query.wallet).map((wallet) => wallet.name)}</p>

        <MenuLink
          href={`${baseUrl}transactions`}
          className={
            router.pathname == "/wallets/[wallet]/transactions"
              ? "text-white"
              : ""
          }
        >
          <List className="h-4 w-4" />
          <div className="flex items-center gap-2">
            Transactions
            {transactions && transactions.length > 0 && (
              <Badge className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full">
                {transactions.length}
              </Badge>
            )}
          </div>
        </MenuLink>
        <MenuLink
          href={`${baseUrl}chat`}
          className={
            router.pathname == "/wallets/[wallet]/chat" ? "text-white" : ""
          }
        >
          <ChatBubbleIcon className="h-4 w-4" />
          Chat
        </MenuLink>
        <MenuLink
          href={`${baseUrl}info`}
          className={
            router.pathname == "/wallets/[wallet]/info" ? "text-white" : ""
          }
        >
          <Info className="h-4 w-4" />
          Info
        </MenuLink>
      </div>

      {/* <MenuLink href={`/`} className={"self-end"}>
        <ArrowLeft className="h-4 w-4" />
        <div className="flex items-center gap-2">Back</div>
      </MenuLink> */}
    </nav>
  );
}
