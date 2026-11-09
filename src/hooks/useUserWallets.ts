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
  const { data: walletSession, isError: sessionCheckFailed } =
    api.auth.getWalletSession.useQuery(
      { address },
      {
        enabled: address.length > 0,
        refetchOnWindowFocus: false,
      },
    );
  // The wallet list is only served to a caller with a session for `address`
  // (the server answers 401/403 otherwise), so wait for the authorization
  // step instead of firing a request that is bound to fail. The layout
  // refetches the session after authorizing, which flips this on.
  const isAuthorized = walletSession?.authorized ?? false;

  const {
    data: wallets,
    isLoading,
    error: walletsError,
  } = api.wallet.getUserWallets.useQuery(
    { address },
    {
      enabled: address.length > 0 && isAuthorized,
      staleTime: 1 * 60 * 1000, // 1 minute (user/wallet data)
      gcTime: 5 * 60 * 1000, // 5 minutes
      retry: (failureCount, error) => {
        // Don't retry on authorization errors (401/403)
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
            err.code === "UNAUTHORIZED" ||
            err.data?.code === "FORBIDDEN" ||
            err.data?.code === "UNAUTHORIZED" ||
            err.data?.httpStatus === 403 ||
            err.data?.httpStatus === 401 ||
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

  // Until the session question is answered the list is effectively loading;
  // once it is answered "no", callers should ask the user to authorize rather
  // than render "you have no wallets".
  // A failed session check is not a "no": the auth modal only opens on an
  // answer, so prompting then would offer a button that does nothing. A list
  // request refused with 401 is a "no" (the cookie expired since the session
  // check was cached).
  const isCheckingSession =
    address.length > 0 && walletSession === undefined && !sessionCheckFailed;
  const listRefused =
    walletsError?.data?.code === "UNAUTHORIZED" ||
    walletsError?.data?.httpStatus === 401;
  const needsAuthorization =
    address.length > 0 &&
    ((walletSession !== undefined && !isAuthorized) || listRefused);

  return {
    wallets: mappedWallets,
    isLoading: isLoading || isCheckingSession,
    needsAuthorization,
  };
}
