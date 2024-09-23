import { api } from "@/utils/api";
import { useRouter } from "next/router";

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
      },
    );

  return { transactions, isLoading };
}
