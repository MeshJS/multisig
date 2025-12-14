import { api } from "@/utils/api";
import { UTxO } from "@meshsdk/core";

/**
 * React Hook to filter available (spendable) UTxOs for a given wallet.
 * Accepts UTxOs as input instead of fetching them, improving efficiency.
 */
export default function useAvailableUtxos({
  walletId,
  utxos,
}: {
  walletId?: string;
  utxos: UTxO[];
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

  // Extract blocked UTxOs from pending transactions
  const blockedUtxos = transactions.flatMap((tx) => {
    const txJson = JSON.parse(tx.txJson);
    return txJson.inputs.map((input: { txIn: { txHash: string; txIndex: number } }) => ({
      hash: input.txIn.txHash,
      index: input.txIn.txIndex,
    }));
  });

  // Filter UTxOs to exclude blocked ones
  const availableUtxos = utxos.filter(
    (utxo) =>
      !blockedUtxos.some(
        (bU) => bU.hash === utxo.input.txHash && bU.index === utxo.input.outputIndex
      )
  );

  return { availableUtxos, isLoading: false, error: null };
}