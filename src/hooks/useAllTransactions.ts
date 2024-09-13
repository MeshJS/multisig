import { api } from "@/utils/api";

export default function useAllTransactions({
  walletId,
}: {
  walletId: string;
}) {
  const { data: transactions, isLoading } =
    api.transaction.getAllTransactions.useQuery({ walletId: walletId });
  return { transactions, isLoading };
}
