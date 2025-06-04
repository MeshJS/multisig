import { api } from "@/utils/api";
import { UTxO } from "@meshsdk/core";

/**
 * React Hook to filter available (spendable) UTxOs for a given wallet.
 * Accepts UTxOs as input instead of fetching them, improving efficiency.
 */
export default function useAvailableUtxos({
  walletId,
  utxos
}: {
  walletId?: string;
  utxos: UTxO[];
}) {
  // Fetch pending transactions using TRPC
  const { data: transactions, isLoading: transactionsLoading } =
    api.transaction.getPendingTransactions.useQuery(
      { walletId: walletId! },
      { enabled: !!walletId },
    );

  if (!utxos || utxos.length === 0 || transactionsLoading) {
    return { availableUtxos: [], isLoading: true, error: null };
  }

  if (!transactions || transactions.length === 0) {
    return { availableUtxos: utxos, isLoading: false, error: null };
  }

  const blockedUtxos: { hash: string; index: number }[] = transactions.flatMap(
    (m) => {
      const txJson = JSON.parse(m.txJson);
      return txJson.inputs.map(
        (n: { txIn: { txHash: string; txIndex: number } }) => ({
          hash: n.txIn.txHash ?? undefined,
          index: n.txIn.txIndex ?? undefined,
        }),
      );
    },
  );

  const freeUtxos = utxos.filter(
    (utxo) =>
      !blockedUtxos.some(
        (bU) =>
          bU.hash === utxo.input.txHash && bU.index === utxo.input.outputIndex,
      ),
  );

  return { freeUtxos, isLoading: false, error: null };
}
