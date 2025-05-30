import { useUserStore } from "@/lib/zustand/user";
import { api } from "@/utils/api";
import { buildWallet } from "./common";
import { useSiteStore } from "@/lib/zustand/site";
import { useRouter } from "next/router";
import { useWalletsStore } from "@/lib/zustand/wallets";

export default function useAppWallet() {
  const router = useRouter();
  const walletId = router.query.wallet as string;

  const network = useSiteStore((state) => state.network);
  const userAddress = useUserStore((state) => state.userAddress);
  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);

  const { data: wallet, isLoading } = api.wallet.getWallet.useQuery(
    { address: userAddress!, walletId: walletId },
    {
      enabled: walletId !== undefined && userAddress !== undefined,
    },
  );

  if (wallet) {
    return { appWallet: buildWallet(wallet, network, walletsUtxos[walletId]), isLoading };
  }

  return { appWallet: undefined, isLoading };
}
