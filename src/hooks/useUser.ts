import { useUserStore } from "@/lib/zustand/user";
import { api } from "@/utils/api";

export default function useUser() {
  const userAddress = useUserStore((state) => state.userAddress);
  const { data: user, isLoading, error } = api.user.getUserByAddress.useQuery(
    { address: userAddress! },
    {
      enabled: userAddress !== undefined && userAddress !== null && userAddress !== "",
      retry: false,
      refetchOnWindowFocus: false,
    },
  );
  
  // Return user as null if there's an error, so the UI can handle it gracefully
  return { 
    user: error ? null : user, 
    isLoading,
    error 
  };
}
