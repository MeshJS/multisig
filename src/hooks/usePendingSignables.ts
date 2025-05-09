import { api } from "@/utils/api";
import { useRouter } from "next/router";

export default function usePendingSignables({
  walletId,
}: {
  walletId?: string | undefined;
} = {}) {
  const router = useRouter();
  const _walletId = walletId
    ? walletId
    : (router.query.wallet as string | undefined);
  const { data: signables, isLoading } =
    api.signable.getPendingSignables.useQuery(
      { walletId: _walletId! },
      {
        enabled: _walletId !== undefined,
      },
    );

  return { signables, isLoading };
}
