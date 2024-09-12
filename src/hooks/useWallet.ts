import { useUserStore } from "@/lib/zustand/user";
import { api } from "@/utils/api";
import { buildWallet } from "./common";

export default function useWallet({ walletId }: { walletId: string }) {
  // const userAddress = useUserStore((state) => state.userAddress); // todo
  const userAddress =
    "addr_test1qp2k7wnshzngpqw0xmy33hvexw4aeg60yr79x3yeeqt3s2uvldqg2n2p8y4kyjm8sqfyg0tpq9042atz0fr8c3grjmysdp6yv3";
  const { data: wallet, isLoading } = api.wallet.getWallet.useQuery(
    { address: userAddress!, walletId: walletId },
    {
      enabled: userAddress !== undefined,
    },
  );

  if (wallet) {
    return { wallet: buildWallet(wallet), isLoading };
  }

  return { wallet: wallet, isLoading };
}
