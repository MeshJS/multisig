import { Wallet } from "@/types/wallet";
import CardUI from "@/components/ui/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import { useWalletsStore } from "@/lib/zustand/wallets";
import Retire from "./drep/retire";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CardInfo({ appWallet }: { appWallet: Wallet }) {
  const drepInfo = useWalletsStore((state) => state.drepInfo);
  return (
    <CardUI
      title="Info"
      description="Note: governance features are currently in alpha as Blockfrost and CIPs standards are work in progress."
      headerDom={
        <DropdownMenu>
          <DropdownMenuTrigger
            className="p-2 rounded-md hover:bg-zinc-100 focus:bg-zinc-100 dark:hover:bg-zinc-800 dark:focus:bg-zinc-800"
            aria-haspopup="true"
          >
            <MoreVertical className="h-4 w-4" />
            <span className="sr-only">Toggle menu</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link
                href={`https://gov.tools/drep_directory/${appWallet.dRepId}`}
              >
                gov.tools
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      cardClassName="col-span-2 p-4 sm:p-6"
    >
      <RowLabelInfo
        label="DRep ID"
        value={appWallet.dRepId}
        copyString={appWallet.dRepId}
      />
      <RowLabelInfo
        label="Status"
        value={drepInfo?.active ? "Registered" : "Not registered"}
      />
      {drepInfo?.active && (
        <RowLabelInfo
          label="VotingPower"
          value={`${Math.round(Number(drepInfo.amount) / 1000000)
            .toString()
            .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₳`}
        />
      )}

      <div className="flex flex-wrap gap-2 sm:flex-nowrap">
        <Button className="flex-1 sm:flex-initial" disabled={drepInfo?.active}>
          <Link href={`/wallets/${appWallet.id}/governance/register`}>
            Register DRep
          </Link>
        </Button>
        <Button className="flex-1 sm:flex-initial" disabled={!drepInfo?.active}>
          <Link href={`/wallets/${appWallet.id}/governance/update`}>
            Update DRep
          </Link>
        </Button>
        <Retire appWallet={appWallet} />
        <Link href={`/wallets/${appWallet.id}/governance/drep`}>
          <Button className="flex-1 sm:flex-initial">Find a DRep</Button>
        </Link>
      </div>
    </CardUI>
  );
}
