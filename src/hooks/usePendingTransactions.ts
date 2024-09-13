import { api } from "@/utils/api";

export default function usePendingTransactions({
  walletId,
}: {
  walletId: string;
}) {
  const { data: transactions, isLoading } =
    api.transaction.getPendingTransactions.useQuery({ walletId: walletId });

  return { transactions, isLoading };
}
