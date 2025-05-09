import { api } from "@/utils/api";
import { useRouter } from "next/router";

export default function useCompleteSignables({
  walletId,
}: {
  walletId?: string | undefined;
} = {}) {
  const router = useRouter();
  const _walletId = walletId
    ? walletId
    : (router.query.wallet as string | undefined);
  const { data: signables, isLoading } =
    api.signable.getCompleteSignables.useQuery(
      { walletId: _walletId! },
      {
        enabled: _walletId !== undefined,
      },
    );

  return { signables, isLoading };
}
