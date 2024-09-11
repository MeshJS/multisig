import { api } from "@/utils/api";

export default function useUser(address: string | undefined) {
  const { data: user, isLoading } = api.user.getUserByAddress.useQuery(
    { address: address! },
    {
      enabled: address !== undefined,
    },
  );
  return { user, isLoading };
}
