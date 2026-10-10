import { api } from "@/utils/api";
import { UTxO } from "@meshsdk/core";

import { deriveBlockedUtxoRefs } from "@/utils/blockedUtxoRefs";

/**
 * React Hook to filter available (spendable) UTxOs for a given wallet.
 * Accepts UTxOs as input instead of fetching them, improving efficiency.
 */
export default function useAvailableUtxos({
  walletId,
  utxos,
  excludeTransactionId,
}: {
  walletId?: string;
  utxos: UTxO[];
  /** Pending tx whose inputs should NOT count as blocked (the tx being edited). */
  excludeTransactionId?: string;
}) {
  // Fetch pending transactions using TRPC
  const { data: transactions, isLoading: transactionsLoading } =
    api.transaction.getPendingTransactions.useQuery(
      { walletId: walletId! },
      {
        enabled: !!walletId,
        staleTime: 30 * 1000, // 30 seconds
        gcTime: 2 * 60 * 1000, // 2 minutes
        // Don't auto-refetch - rely on other hooks to trigger updates
        refetchOnWindowFocus: false,
        refetchOnMount: false,
      }
    );

  if (!utxos || utxos.length === 0 || transactionsLoading) {
    return { availableUtxos: [], isLoading: true, error: null };
  }

  if (!transactions || transactions.length === 0) {
    return { availableUtxos: utxos, isLoading: false, error: null };
  }

  const blockedUtxos = deriveBlockedUtxoRefs(transactions, excludeTransactionId);

  // Filter UTxOs to exclude blocked ones
  const availableUtxos = utxos.filter(
    (utxo) =>
      !blockedUtxos.some(
        (bU) => bU.hash === utxo.input.txHash && bU.index === utxo.input.outputIndex
      )
  );

  return { availableUtxos, isLoading: false, error: null };
}
