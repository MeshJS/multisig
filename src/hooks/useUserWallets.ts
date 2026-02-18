import { useUserStore } from "@/lib/zustand/user";
import { useSiteStore } from "@/lib/zustand/site";
import { api } from "@/utils/api";
import { buildWallet } from "@/utils/common";
import { DbWalletWithLegacy } from "@/types/wallet";
import { useMemo } from "react";

export default function useUserWallets() {
  const network = useSiteStore((state) => state.network);
  const userAddress = useUserStore((state) => state.userAddress);
  const address = userAddress ?? "";
  
  // Check wallet session authorization before enabling queries
  const { data: walletSession } = api.auth.getWalletSession.useQuery(
    { address },
    {
      enabled: address.length > 0,
      refetchOnWindowFocus: false,
    },
  );
  const isAuthorized = walletSession?.authorized ?? false;
  const sessionWallets = walletSession?.wallets ?? [];
  // If there's no wallet-session constraint, public read queries can run without authorization
  const canQueryPublicWalletData = sessionWallets.length === 0 || isAuthorized;
  
  const { data: wallets, isLoading } = api.wallet.getUserWallets.useQuery(
    { address },
    {
      // Only enable query when user is authorized (prevents 403 errors)
      enabled: address.length > 0 && canQueryPublicWalletData,
      staleTime: 1 * 60 * 1000, // 1 minute (user/wallet data)
      gcTime: 5 * 60 * 1000, // 5 minutes
      retry: (failureCount, error) => {
        // Don't retry on authorization errors (403)
        if (error && typeof error === "object") {
          const err = error as { 
            code?: string; 
            message?: string; 
            data?: { code?: string; httpStatus?: number };
            shape?: { code?: string; message?: string };
          };
          const errorMessage = err.message || err.shape?.message || "";
          const isAuthError =
            err.code === "FORBIDDEN" ||
            err.data?.code === "FORBIDDEN" ||
            err.data?.httpStatus === 403 ||
            err.shape?.code === "FORBIDDEN" ||
            errorMessage.includes("Address mismatch");
          if (isAuthError) return false;
        }
        return failureCount < 1; // Only retry once for other errors
      },
    },
  );

  const mappedWallets = useMemo(() => {
    if (!wallets) return undefined;

    return wallets
      .filter((wallet): wallet is DbWalletWithLegacy => wallet != null)
      .map((wallet) => buildWallet(wallet, network));
  }, [wallets, network]);

  return { wallets: mappedWallets, isLoading };
}
