import { BlockfrostDrepInfo } from "@/types/governance";
import CardInfo from "./card-info";
import { useEffect, useState } from "react";
import { getProvider } from "@/utils/get-provider";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { useSiteStore } from "@/lib/zustand/site";
import AllProposals from "./proposals";
import useAppWallet from "@/hooks/useAppWallet";
import VoteCard from "./vote-card";
import { getDRepIds } from "@meshsdk/core-cst";
import ClarityCard from "./clarity/card-clarity";
import VoteCC from "./cCommitee/voteCC";
import UTxOSelector from "../new-transaction/utxoSelector";
import { UTxO } from "@meshsdk/core";
import CardUI from "@/components/ui/card-content";

export default function PageGovernance() {
  const { appWallet } = useAppWallet();
  const setDrepInfo = useWalletsStore((state) => state.setDrepInfo);
  const network = useSiteStore((state) => state.network);
  const randomState = useSiteStore((state) => state.randomState);
  const [manualUtxos, setManualUtxos] = useState<UTxO[]>([]);
  const [manualSelected, setManualSelected] = useState(false);

  if (appWallet === undefined) return <></>;
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <CardInfo appWallet={appWallet} />
        <AllProposals appWallet={appWallet} utxos={manualUtxos} />
        <VoteCard appWallet={appWallet} utxos={manualUtxos} />
        <ClarityCard appWallet={appWallet} />
        <div className="flex flex-col gap-4 col-span-2">
          {appWallet && (
            <UTxOSelector
              appWallet={appWallet}
              network={network}
              onSelectionChange={(utxos, manual) => {
                setManualUtxos(utxos);
                setManualSelected(manual);
              }}
            />
          )}
          {false && (
            <VoteCC
              manualUtxos={manualUtxos}
              manualSelected={manualSelected}
              appWallet={appWallet}
              network={network}
            />
          )}
        </div>
      </div>
    </main>
  );
}
