import { api } from "@/utils/api";

export default function useAllTransactions({
  walletId,
}: {
  walletId: string;
}) {
  const { data: transactions, isLoading } =
    api.transaction.getAllTransactions.useQuery(
      { walletId: walletId },
      {
        staleTime: 2 * 60 * 1000, // 2 minutes (transaction history)
        gcTime: 5 * 60 * 1000, // 5 minutes
      }
    );
  return { transactions, isLoading };
}
