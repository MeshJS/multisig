import { useUserStore } from "@/lib/zustand/user";
import { api } from "@/utils/api";

export default function useUser() {
  const userAddress = useUserStore((state) => state.userAddress);
  const { data: user, isLoading } = api.user.getUserByAddress.useQuery(
    { address: userAddress! },
    {
      enabled: userAddress !== undefined,
    },
  );
  return { user, isLoading };
}
