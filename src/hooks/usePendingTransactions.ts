import { api } from "@/utils/api";
import { useRouter } from "next/router";
import { useMemo } from "react";

type Transaction = {
  id: string;
  state: number;
  txHash: string | null;
  signedAddresses: string[];
  rejectedAddresses: string[];
  [key: string]: unknown;
};

/**
 * Compare two transaction arrays to determine if they're actually different
 * Only considers meaningful changes (new transactions, state changes, etc.)
 */
function areTransactionsEqual(
  oldData: Transaction[] | undefined,
  newData: Transaction[] | undefined,
): boolean {
  // Both undefined/null - same
  if (!oldData && !newData) return true;
  
  // One is undefined - different
  if (!oldData || !newData) return false;
  
  // Different lengths - different
  if (oldData.length !== newData.length) return false;
  
  // Create a map of transaction IDs for quick lookup
  const oldMap = new Map(oldData.map(tx => [tx.id, tx]));
  const newMap = new Map(newData.map(tx => [tx.id, tx]));
  
  // Check if all IDs match
  if (oldMap.size !== newMap.size) return false;
  
  // Check if any transaction has changed (state, signedAddresses, etc.)
  for (const [id, oldTx] of oldMap) {
    const newTx = newMap.get(id);
    if (!newTx) return false; // Transaction removed
    
    // Compare meaningful fields
    if (
      oldTx.state !== newTx.state ||
      oldTx.txHash !== newTx.txHash ||
      JSON.stringify(oldTx.signedAddresses) !== JSON.stringify(newTx.signedAddresses) ||
      JSON.stringify(oldTx.rejectedAddresses) !== JSON.stringify(newTx.rejectedAddresses)
    ) {
      return false; // Transaction changed
    }
  }
  
  return true; // All transactions are the same
}

export default function usePendingTransactions({
  walletId,
}: {
  walletId?: string | undefined;
} = {}) {
  const router = useRouter();
  const _walletId = walletId
    ? walletId
    : (router.query.wallet as string | undefined);
  
  const { data: transactions, isLoading } =
    api.transaction.getPendingTransactions.useQuery(
      { walletId: _walletId! },
      {
        enabled: _walletId !== undefined,
        staleTime: 30 * 1000, // 30 seconds (frequently changing)
        gcTime: 2 * 60 * 1000, // 2 minutes
        // Only refetch if data is stale AND window is focused
        refetchInterval: (query) => {
          // Only refetch if data is stale (older than staleTime)
          const dataAge = Date.now() - (query.state.dataUpdatedAt || 0);
          if (dataAge < 30 * 1000) {
            return false; // Data is fresh, don't refetch
          }
          // Refetch every 10s if data is stale
          return 10 * 1000;
        },
        refetchIntervalInBackground: false, // Don't refetch in background
        // Use structural sharing to prevent unnecessary re-renders
        structuralSharing: (oldData, newData) => {
          // If data is actually the same, return old data to prevent re-render
          if (areTransactionsEqual(oldData, newData)) {
            return oldData;
          }
          return newData;
        },
      },
    );

  return { transactions, isLoading };
}
