import { useUserStore } from "@/lib/zustand/user";
import { api } from "@/utils/api";
import { buildWallet } from "./common";
import { useSiteStore } from "@/lib/zustand/site";

export default function useAppWallet({ walletId }: { walletId: string }) {
  const network = useSiteStore((state) => state.network);
  const userAddress = useUserStore((state) => state.userAddress);
  const { data: wallet, isLoading } = api.wallet.getWallet.useQuery(
    { address: userAddress!, walletId: walletId },
    {
      enabled: walletId !== undefined && userAddress !== undefined,
    },
  );

  if (wallet) {
    return { appWallet: buildWallet(wallet, network), isLoading };
  }

  return { appWallet: wallet, isLoading };
}
