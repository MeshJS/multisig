import { Info, List, Scale } from "lucide-react";
import { useRouter } from "next/router";
import MenuLink from "./menu-link";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import { Badge } from "@/components/ui/badge";
import { ChatBubbleIcon } from "@radix-ui/react-icons";

export default function MenuWallet() {
  const router = useRouter();
  const baseUrl = `/wallets/${router.query.wallet as string | undefined}/`;

  const { transactions } = usePendingTransactions();

  return (
    <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
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
        href={`${baseUrl}governance`}
        className={
          router.pathname == "/wallets/[wallet]/governance" ? "text-white" : ""
        }
      >
        <Scale className="h-4 w-4" />
        Governance
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
    </nav>
  );
}
