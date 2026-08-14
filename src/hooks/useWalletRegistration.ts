import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useSiteStore } from "@/lib/zustand/site";
import type { MultisigWallet } from "@/utils/multisigSDK";
import {
  participantsMatchExactly,
  type Label1854LookupItem,
} from "@/utils/cip146Registration";

/**
 * Looks up the wallet's CIP-0146 (label 1854) registration status via
 * /api/v1/lookupMultisigWallet. The endpoint matches on ANY shared
 * participant hash, so `isRegistered` applies exact participant-set
 * comparison to identify this specific wallet's registration.
 *
 * `registrations` is ordered oldest-first (the endpoint preserves the
 * chain's ascending order), so the last matching item carries the most
 * recent metadata.
 */
export default function useWalletRegistration(
  mWallet: MultisigWallet | undefined,
) {
  const network = useSiteStore((state) => state.network);

  const keyHashes = useMemo(() => {
    if (!mWallet) return [];
    return Array.from(new Set(mWallet.keys.map((k) => k.keyHash.toLowerCase())));
  }, [mWallet]);

  const query = useQuery({
    queryKey: ["walletRegistration", network, keyHashes],
    enabled: keyHashes.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Label1854LookupItem[]> => {
      // The endpoint caps pubKeyHashes at 50; wallets here are far
      // smaller, but slice defensively rather than erroring.
      const hashes = keyHashes.slice(0, 50).join(",");
      const res = await fetch(
        `/api/v1/lookupMultisigWallet?pubKeyHashes=${hashes}&network=${network}`,
      );
      if (!res.ok) {
        throw new Error(`Registration lookup failed (${res.status})`);
      }
      const data: unknown = await res.json();
      return Array.isArray(data) ? (data as Label1854LookupItem[]) : [];
    },
  });

  const matchedRegistrations = useMemo(() => {
    if (!query.data) return [];
    return query.data.filter((item) =>
      participantsMatchExactly(item, keyHashes),
    );
  }, [query.data, keyHashes]);

  return {
    /** undefined while loading, then whether an exact-set match exists */
    isRegistered: query.isLoading ? undefined : matchedRegistrations.length > 0,
    /** exact-set matches for this wallet, oldest first */
    registrations: matchedRegistrations,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
