import { Info } from "lucide-react";
import { Wallet } from "@/types/wallet";
import CardUI from "@/components/common/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import { useWalletsStore } from "@/lib/zustand/wallets";
import Retire from "./retire";
import Button from "@/components/common/button";
import Link from "next/link";

export default function CardInfo({ appWallet }: { appWallet: Wallet }) {
  const drepRegistered = useWalletsStore((state) => state.drepRegistered);

  return (
    <CardUI title="Info" icon={Info}>
      <RowLabelInfo
        label="DRep ID"
        value={appWallet.dRepId}
        copyString={appWallet.dRepId}
      />
      <RowLabelInfo
        label="Status"
        // value={drepRegistered ? "Registered" : `Not registered`}
        value={`Unknown, blockfrost bug`}
      />
      <div className="flex gap-2">
        <Button>
          <Link href={`/wallets/${appWallet.id}/governance/register`}>
            Register DRep
          </Link>
        </Button>
        <Retire appWallet={appWallet} />
      </div>
    </CardUI>
  );
}
