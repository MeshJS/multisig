import { BlockfrostDrepInfo, Wallet } from "@/types/wallet";
import CardInfo from "./card-info";
import CardRegister from "./register";
import { useEffect } from "react";
import { getProvider } from "@/components/common/cardano-objects";
import { useWalletsStore } from "@/lib/zustand/wallets";

export default function TabGovernance({ appWallet }: { appWallet: Wallet }) {
  const setDrepInfo = useWalletsStore((state) => state.setDrepInfo);
  const drepRegistered = useWalletsStore((state) => state.drepRegistered);

  useEffect(() => {
    async function load() {
      if (appWallet) {
        const blockchainProvider = getProvider();
        const drepInfo: BlockfrostDrepInfo = await blockchainProvider.get(
          `/governance/dreps/${appWallet.dRepId}`,
        );
        setDrepInfo(drepInfo);
      }
    }
    load();
  }, []);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <CardInfo appWallet={appWallet} />
        {!drepRegistered && <CardRegister appWallet={appWallet} />}
      </div>
    </main>
  );
}
