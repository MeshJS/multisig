import { Wallet } from "@/types/wallet";
import CardUI from "@/components/ui/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import { useWalletsStore } from "@/lib/zustand/wallets";
import Retire from "./drep/retire";
import Button from "@/components/common/button";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical } from "lucide-react";

export default function CardInfo({ appWallet }: { appWallet: Wallet }) {
  const drepInfo = useWalletsStore((state) => state.drepInfo);
  return (
    <CardUI
      title="Info"
      description="Note: governance features are currently in alpha as Blockfrost and CIPs standards are work in progress."
      headerDom={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-haspopup="true" size="icon" variant="ghost">
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link
                href={`https://gov.tools/drep_directory/${appWallet.dRepId}`}
              >
                gov.tools
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem>test</DropdownMenuItem>
            <DropdownMenuItem>test</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      cardClassName="col-span-2"
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
      <div className="flex gap-2">
        <Button disabled={drepInfo?.active}>
          <Link href={`/wallets/${appWallet.id}/governance/register`}>
            Register DRep
          </Link>
        </Button>
        <Button disabled={!drepInfo?.active}>
          <Link href={`/wallets/${appWallet.id}/governance/update`}>
            Update DRep
          </Link>
        </Button>
        <Retire appWallet={appWallet} />
        <Link href={`/wallets/${appWallet.id}/governance/drep`}>
          <Button>Find a DRep</Button>
        </Link>
      </div>
    </CardUI>
  );
}
