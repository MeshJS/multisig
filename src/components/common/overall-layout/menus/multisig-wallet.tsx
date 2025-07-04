import { Banknote, Info, List, Landmark, UserRoundPen, ChartNoAxesColumnIncreasing } from "lucide-react";
import { useRouter } from "next/router";
import MenuLink from "./menu-link";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import useUserWallets from "@/hooks/useUserWallets";
import { Badge } from "@/components/ui/badge";
import { ChatBubbleIcon } from "@radix-ui/react-icons";
import usePendingSignables from "@/hooks/usePendingSignables";
import useMultisigWallet from "@/hooks/useMultisigWallet";

export default function MenuWallet() {
  const router = useRouter();
  const baseUrl = `/wallets/${router.query.wallet as string | undefined}/`;
  const { wallets } = useUserWallets();
  const { transactions } = usePendingTransactions();
  const { signables } = usePendingSignables();
  const { multisigWallet } = useMultisigWallet();
  if (!wallets) return;
  return (
    <nav className="grid h-full items-start px-2 text-sm font-medium lg:px-4">
      <div className="grid items-start">
        <MenuLink
          href={`${baseUrl}governance`}
          className={
            router.pathname == "/wallets/[wallet]/governance" ? "text-white" : ""
          }
        >
          <Landmark className="h-5 w-5" />
          <div className="flex items-center gap-2">Governance</div>
        </MenuLink>
        <MenuLink
          href={`${baseUrl}transactions`}
          className={
            router.pathname == "/wallets/[wallet]/transactions"
              ? "text-white"
              : ""
          }
        >
          <List className="h-5 w-5" />
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
          href={`${baseUrl}signing`}
          className={
            router.pathname == "/wallets/[wallet]/signing" ? "text-white" : ""
          }
        >
          <UserRoundPen className="h-5 w-5" />
          <div className="flex items-center gap-2">
            Signing
            {signables && signables.length > 0 && (
              <Badge className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full">
                {signables.length}
              </Badge>
            )}
          </div>
        </MenuLink>
        {multisigWallet && multisigWallet.stakingEnabled() && <MenuLink
          href={`${baseUrl}staking`}
          className={
            router.pathname == "/wallets/[wallet]/staking" ? "text-white" : ""
          }
        >
          <ChartNoAxesColumnIncreasing className="h-6 w-6" />
          Staking
        </MenuLink>}
        <MenuLink
          href={`${baseUrl}assets`}
          className={
            router.pathname == "/wallets/[wallet]/assets" ? "text-white" : ""
          }
        >
          <Banknote className="h-5 w-5" />
          <div className="flex items-center gap-2">Assets</div>
        </MenuLink>
        <MenuLink
          href={`${baseUrl}chat`}
          className={
            router.pathname == "/wallets/[wallet]/chat" ? "text-white" : ""
          }
        >
          <ChatBubbleIcon className="h-5 w-5" />
          <div className="flex items-center gap-2">Chat</div>
        </MenuLink>
        <MenuLink
          href={`${baseUrl}info`}
          className={
            router.pathname == "/wallets/[wallet]/info" ? "text-white" : ""
          }
        >
          <Info className="h-5 w-5" />
          <div className="flex items-center gap-2">Info</div>
        </MenuLink>
      </div>

      {/* <MenuLink href={`/`} className={"self-end"}>
        <ArrowLeft className="h-4 w-4" />
        <div className="flex items-center gap-2">Back</div>
      </MenuLink> */}
    </nav>
  );
}
