import { useQuery } from "@tanstack/react-query";
import type { UTxO } from "@meshsdk/core";

import { useSiteStore } from "@/lib/zustand/site";
import { getProvider } from "@/utils/get-provider";

/**
 * Spendable UTxOs of an arbitrary address (a builder source other than the
 * multisig). Client-direct Blockfrost, like `useTxFlowData`; short stale
 * time because balances move. Disabled without an address so half-typed
 * source addresses never hit the network.
 */
export function useAddressUtxos(
  address: string | undefined,
  opts?: { enabled?: boolean },
) {
  const network = useSiteStore((state) => state.network);
  return useQuery<UTxO[]>({
    queryKey: ["address-utxos", network, address],
    queryFn: () => getProvider(network).fetchAddressUTxOs(address!),
    enabled: !!address && (opts?.enabled ?? true),
    staleTime: 30_000,
    retry: 1,
  });
}
