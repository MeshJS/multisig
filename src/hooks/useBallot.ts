import { api } from "@/utils/api";
import { useCallback } from "react";

export function useBallot(walletId?: string) {
  const {
    data: ballots,
    isLoading,
    error,
    refetch,
  } = api.ballot.getByWallet.useQuery(
    { walletId: walletId ?? "" },
    { enabled: !!walletId }
  );

  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  return { ballots, isLoading, error, refresh, refetch };
}
