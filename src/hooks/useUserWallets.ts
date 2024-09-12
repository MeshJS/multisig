import { useUserStore } from "@/lib/zustand/user";
import { api } from "@/utils/api";
import { buildWallet } from "./common";

export default function useUserWallets() {
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
      return buildWallet(wallet);
    });
  }

  return { wallets: _wallets, isLoading };
}
