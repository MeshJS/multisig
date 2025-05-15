import { useUserStore } from "@/lib/zustand/user";
import { useSiteStore } from "@/lib/zustand/site";
import { api } from "@/utils/api";
import { buildWallet } from "./common";

export default function useUserWallets() {
  const network = useSiteStore((state) => state.network);
  const userAddress = useUserStore((state) => state.userAddress);
  const { data: wallets, isLoading } = api.wallet.getUserWallets.useQuery(
    { address: userAddress! },
    {
      enabled: userAddress !== undefined,
    },
  );

  let _wallets = wallets;

  if (wallets) {
    _wallets = wallets.map((wallet) => {
      return buildWallet(wallet, network);
    });
    return { wallets: _wallets, isLoading };
  }

  return { wallets: undefined, isLoading };
}
