import { Banknote, Info, List, Landmark, UserRoundPen, ChartNoAxesColumnIncreasing, FileCode2 } from "lucide-react";
import { useRouter } from "next/router";
import MenuLink from "./menu-link";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import { Badge } from "@/components/ui/badge";
import { ChatBubbleIcon } from "@radix-ui/react-icons";
import usePendingSignables from "@/hooks/usePendingSignables";
import useMultisigWallet from "@/hooks/useMultisigWallet";

interface MenuWalletProps {
  walletId?: string;
  stakingEnabled?: boolean;
}

export default function MenuWallet({ walletId, stakingEnabled }: MenuWalletProps) {
  const router = useRouter();
  const effectiveWalletId = walletId || (router.query.wallet as string | undefined);
  const baseUrl = `/wallets/${effectiveWalletId}/`;
  const { transactions } = usePendingTransactions();
  const { signables } = usePendingSignables();
  const { multisigWallet } = useMultisigWallet();

  // Use fallback staking enabled if provided, otherwise check multisigWallet
  const showStaking = stakingEnabled !== undefined
    ? stakingEnabled
    : (multisigWallet ? multisigWallet.stakingEnabled() : false);

  return (
    <div className="grid items-start px-2 font-medium lg:px-4">
      <div className="grid items-start space-y-1">
        {/* Wallet Items */}
        <div className="mt-1 pt-1 space-y-1">
          <div className="px-3 py-1 text-xs font-medium text-muted-foreground">
            Wallet
          </div>
        <MenuLink
          href={`${baseUrl}`}
          className={
            router.pathname == "/wallets/[wallet]" || router.pathname == "/wallets/[wallet]/info" ? "text-white" : ""
          }
        >
          <Info className="h-5 w-5" />
          Overview
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
          <span className="flex-1">Transactions</span>
          {transactions && transactions.length > 0 && (
            <Badge className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full">
              {transactions.length}
            </Badge>
          )}
        </MenuLink>
        <MenuLink
          href={`${baseUrl}governance`}
          className={
            router.pathname == "/wallets/[wallet]/governance" ? "text-white" : ""
          }
        >
          <Landmark className="h-5 w-5" />
          Governance
        </MenuLink>
        <MenuLink
          href={`${baseUrl}signing`}
          className={
            router.pathname == "/wallets/[wallet]/signing" ? "text-white" : ""
          }
        >
          <UserRoundPen className="h-5 w-5" />
          <span className="flex-1">Signing</span>
          {signables && signables.length > 0 && (
            <Badge className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full">
              {signables.length}
            </Badge>
          )}
        </MenuLink>
        {showStaking && (
          <MenuLink
            href={`${baseUrl}staking`}
            className={
              router.pathname == "/wallets/[wallet]/staking" ? "text-white" : ""
            }
          >
            <ChartNoAxesColumnIncreasing className="h-5 w-5" />
            Staking
          </MenuLink>
        )}
        <MenuLink
          href={`${baseUrl}assets`}
          className={
            router.pathname == "/wallets/[wallet]/assets" ? "text-white" : ""
          }
        >
          <Banknote className="h-5 w-5" />
          Assets
        </MenuLink>
        <MenuLink
          href={`${baseUrl}chat`}
          className={
            router.pathname == "/wallets/[wallet]/chat" ? "text-white" : ""
          }
        >
          <ChatBubbleIcon className="h-5 w-5" />
          Chat
        </MenuLink>
        <MenuLink
          href={`${baseUrl}dapps`}
          className={
            router.pathname == "/wallets/[wallet]/dapps" ? "text-white" : ""
          }
        >
          <FileCode2 className="h-5 w-5" />
          Dapps
        </MenuLink>
        </div>
      </div>
    </div>
  );
}
