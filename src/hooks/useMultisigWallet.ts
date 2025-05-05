import { useRouter } from "next/router";

import { Wallet as DbWallet } from "@prisma/client";
import { resolvePaymentKeyHash, resolveStakeKeyHash } from "@meshsdk/core";

import { MultisigKey, MultisigWallet } from "@/utils/multisigSDK";

import { api } from "@/utils/api";
import { useSiteStore } from "@/lib/zustand/site";
import { useUserStore } from "@/lib/zustand/user";

function buildWallet(
  wallet: DbWallet,
  network: number,
): MultisigWallet | undefined {
  const keys: MultisigKey[] = [];
  if (wallet.signersAddresses.length > 0) {
    wallet.signersAddresses.forEach((addr, i) => {
      if (addr) {
        try {
          const paymentHash = resolvePaymentKeyHash(addr);
          keys.push({
            keyHash: paymentHash,
            role: 0,
            name: wallet.signersDescriptions[i] || "",
          });
        } catch (e) {
          console.warn(`Invalid payment address at index ${i}:`, addr);
        }
      }
    });
  }
  if (wallet.signersStakeKeys.length > 0) {
    wallet.signersStakeKeys.forEach((stakeKey, i) => {
      if (stakeKey) {
        try {
          const stakeKeyHash = resolveStakeKeyHash(stakeKey);
          keys.push({
            keyHash: stakeKeyHash,
            role: 2,
            name: wallet.signersDescriptions[i] || "",
          });
        } catch (e) {
          console.warn(`Invalid stake address at index ${i}:`, stakeKey);
        }
      }
    });
  }
  if (keys.length === 0) return;
  const multisigWallet = new MultisigWallet(
    wallet.name,
    keys,
    wallet.description ?? "",
    wallet.numRequiredSigners ?? 1,
    network,
  );
  return multisigWallet;
}

export default function useMultisigWallet() {
  const router = useRouter();
  const walletId = router.query.wallet as string;

  const network = useSiteStore((state) => state.network);
  const userAddress = useUserStore((state) => state.userAddress);

  const { data: wallet, isLoading } = api.wallet.getWallet.useQuery(
    { address: userAddress!, walletId: walletId },
    {
      enabled: walletId !== undefined && userAddress !== undefined,
    },
  );
  if (wallet && network !== undefined) {
    return { multisigWallet: buildWallet(wallet, network), isLoading };
  }

  return { multisigWallet: undefined, isLoading };
}
