import { BlockfrostDrepInfo } from "@/types/governance";
import CardInfo from "./card-info";
import { useEffect } from "react";
import { getProvider } from "@/components/common/cardano-objects/get-provider";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { useSiteStore } from "@/lib/zustand/site";
import AllProposals from "./proposals";
import useAppWallet from "@/hooks/useAppWallet";
import VoteCard from "./vote-card";
import { getDRepIds } from "@meshsdk/core-cst";
import ClarityCard from "./clarity/card-clarity";

export default function PageGovernance() {
  const { appWallet } = useAppWallet();
  const setDrepInfo = useWalletsStore((state) => state.setDrepInfo);
  const network = useSiteStore((state) => state.network);
  const randomState = useSiteStore((state) => state.randomState);

  useEffect(() => {
    async function load() {
      if (appWallet) {
        const blockchainProvider = getProvider(network);
        // console.log("appWallet.dRepId", appWallet.dRepId);
        const drepids = getDRepIds(appWallet.dRepId);
        // console.log("drepids", drepids);
        const drepInfo: BlockfrostDrepInfo = await blockchainProvider.get(
          `/governance/dreps/${drepids.cip105}`,
        );
        // console.log("drepInfo", drepInfo);
        setDrepInfo(drepInfo);

        // get metadata
        const drepInfoMetadata = await blockchainProvider.get(
          `/governance/dreps/${drepids.cip105}/metadata`,
        );
        // console.log("drepInfoMetadata", drepInfoMetadata);
      }
    }
    load();
  }, [randomState]);

  if (appWallet === undefined) return <></>;
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <CardInfo appWallet={appWallet} />
        <AllProposals appWallet={appWallet} />
        <VoteCard appWallet={appWallet} />
        <ClarityCard appWallet={appWallet} />
      </div>
    </main>
  );
}
