import { BlockfrostDrepInfo } from "@/types/wallet";
import CardInfo from "./card-info";
import { useEffect } from "react";
import { getProvider } from "@/components/common/cardano-objects/get-provider";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { useSiteStore } from "@/lib/zustand/site";
import AllProposals from "./proposals";
import useAppWallet from "@/hooks/useAppWallet";
import VoteCard from "./vote-card";

export default function PageGovernance() {
  const { appWallet } = useAppWallet();
  const setDrepInfo = useWalletsStore((state) => state.setDrepInfo);
  const network = useSiteStore((state) => state.network);
  const randomState = useSiteStore((state) => state.randomState);

  useEffect(() => {
    async function load() {
      if (appWallet) {
        const blockchainProvider = getProvider(network);
        const drepInfo: BlockfrostDrepInfo = await blockchainProvider.get(
          `/governance/dreps/${appWallet.dRepId}`,
        );
        console.log("drepInfo", drepInfo);
        setDrepInfo(drepInfo);

        // get metadata
        const drepInfoMetadata = await blockchainProvider.get(
          `/governance/dreps/${appWallet.dRepId}/metadata`,
        );
        console.log("drepInfoMetadata", drepInfoMetadata);
      }
    }
    load();
  }, [randomState]);

  if (appWallet === undefined) return <></>;
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <CardInfo appWallet={appWallet} />
        <VoteCard appWallet={appWallet} />
        <AllProposals appWallet={appWallet} />
      </div>
    </main>
  );
}
