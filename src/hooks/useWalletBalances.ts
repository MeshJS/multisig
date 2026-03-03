import { useEffect, useRef, useState, useCallback } from "react";
import { serializeNativeScript } from "@meshsdk/core";
import { Wallet } from "@/types/wallet";
import { getProvider } from "@/utils/get-provider";
import { addressToNetwork } from "@/utils/multisigSDK";
import { buildMultisigWallet, buildWallet, getWalletType } from "@/utils/common";
import { scriptHashFromCbor } from "@/utils/nativeScriptUtils";
import { useSiteStore } from "@/lib/zustand/site";
import { useWalletBalancesStore } from "@/lib/zustand/wallet-balances";

type WalletBalanceState = "idle" | "loading" | "loaded" | "error";

interface UseWalletBalancesResult {
  balances: Record<string, number | null>;
  loadingStates: Record<string, WalletBalanceState>;
  isFetching: boolean;
}

interface UseWalletBalancesOptions {
  cooldownMs?: number;
}

function isKnown404Error(error: unknown): boolean {
  const maybeError = error as {
    response?: { status?: unknown; data?: { status_code?: unknown } };
    status?: unknown;
    data?: { status_code?: unknown };
  };

  const responseStatus = maybeError.response?.status;
  if (typeof responseStatus === "number") {
    return responseStatus === 404;
  }

  const responseDataStatus = maybeError.response?.data?.status_code;
  if (typeof responseDataStatus === "number") {
    return responseDataStatus === 404;
  }

  const topLevelStatus = maybeError.status;
  if (typeof topLevelStatus === "number") {
    return topLevelStatus === 404;
  }

  const topLevelDataStatus = maybeError.data?.status_code;
  if (typeof topLevelDataStatus === "number") {
    return topLevelDataStatus === 404;
  }

  return false;
}

export default function useWalletBalances(
  wallets: Wallet[] | undefined,
  options: UseWalletBalancesOptions = {},
): UseWalletBalancesResult {
  const { cooldownMs = 400 } = options;
  const network = useSiteStore((state) => state.network);
  // Access store actions directly to ensure they're stable references
  const setBalance = useWalletBalancesStore((state) => state.setBalance);
  const getCachedBalance = useWalletBalancesStore((state) => state.getCachedBalance);
  const clearExpiredBalances = useWalletBalancesStore((state) => state.clearExpiredBalances);

  const [balances, setBalances] = useState<Record<string, number | null>>({});
  const [loadingStates, setLoadingStates] = useState<
    Record<string, WalletBalanceState>
  >({});
  const [isFetching, setIsFetching] = useState(false);

  const queueRef = useRef<Wallet[]>([]);
  const processingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchedWalletsRef = useRef<Set<string>>(new Set());
  const initializedWalletsRef = useRef<Set<string>>(new Set());
  const lastWalletIdsRef = useRef<string>("");

  // Clear expired balances once on mount (not on every wallets change)
  const hasClearedExpiredRef = useRef(false);
  useEffect(() => {
    if (!hasClearedExpiredRef.current) {
      clearExpiredBalances();
      hasClearedExpiredRef.current = true;
    }
  }, [clearExpiredBalances]);

  // Abort any in-flight processing only when the hook unmounts.
  // Avoid aborting on every render/dependency update.
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const getCanonicalWalletAddress = useCallback(
    (wallet: Wallet): string => {
      return wallet.capabilities!.address;
    },
    [],
  );

  const fetchWalletBalance = useCallback(
    async (wallet: Wallet): Promise<void> => {
      // Skip if already fetched in this session
      if (fetchedWalletsRef.current.has(wallet.id)) {
        return;
      }

      // Check cache first (5 minute cache duration)
      const cachedData = getCachedBalance(wallet.id, 5 * 60 * 1000);
      if (cachedData) {
        // Use cached balance
        setBalances((prev) => ({ ...prev, [wallet.id]: cachedData.balance }));
        setLoadingStates((prev) => ({ ...prev, [wallet.id]: "loaded" }));
        fetchedWalletsRef.current.add(wallet.id);
        return;
      }

      // Mark as loading
      setLoadingStates((prev) => ({ ...prev, [wallet.id]: "loading" }));
      const walletAddress = getCanonicalWalletAddress(wallet);

      try {
        // Use a canonical address depending on wallet type.
        // SDK wallets: script address from MultisigWallet
        // Summon wallets: stored rawImportBodies.multisig.address
        // Legacy wallets: derived script address from payment keys
        // Use the network determined from the address
        const addressNetwork = addressToNetwork(walletAddress);
        const provider = getProvider(addressNetwork);

        // Fetch address info using Blockfrost API
        // This returns an object with an 'amount' array containing assets
        const addressInfo = await provider.get(`/addresses/${walletAddress}/`);

        // Calculate balance from assets
        // Blockfrost returns { amount: [{ unit: string, quantity: string }] }
        let balance = 0;
        if (addressInfo && addressInfo.amount && Array.isArray(addressInfo.amount)) {
          const lovelaceAsset = addressInfo.amount.find(
            (asset: { unit: string; quantity: string }) => asset.unit === "lovelace"
          );
          if (lovelaceAsset) {
            const lovelaceAmount = parseInt(lovelaceAsset.quantity);
            balance = lovelaceAmount / 1000000;
            balance = Math.round(balance * 100) / 100;
          }
        }

        // Update local state
        setBalances((prev) => ({ ...prev, [wallet.id]: balance }));
        setLoadingStates((prev) => ({ ...prev, [wallet.id]: "loaded" }));

        // Cache the balance in Zustand store (including successful fetches)
        setBalance(wallet.id, balance, walletAddress);

        fetchedWalletsRef.current.add(wallet.id);
      } catch (error: unknown) {
        // 404 is expected for never-used addresses.
        const is404 = isKnown404Error(error);

        if (is404) {
          // Set balance to 0 and cache to avoid repeated lookups for fresh addresses.
          setBalances((prev) => ({ ...prev, [wallet.id]: 0 }));
          setLoadingStates((prev) => ({ ...prev, [wallet.id]: "loaded" }));
          setBalance(wallet.id, 0, walletAddress);
          fetchedWalletsRef.current.add(wallet.id);
        } else {
          // Only log non-404 errors
          console.error(`Error fetching balance for wallet ${wallet.id}:`, error);
          setBalances((prev) => ({ ...prev, [wallet.id]: null }));
          setLoadingStates((prev) => ({ ...prev, [wallet.id]: "error" }));
          fetchedWalletsRef.current.add(wallet.id);
        }
      }
    },
    [network, getCachedBalance, setBalance, getCanonicalWalletAddress],
  );

  const processQueue = useCallback(async () => {
    if (processingRef.current) {
      return;
    }

    if (queueRef.current.length === 0) {
      setIsFetching(false);
      return;
    }

    processingRef.current = true;
    setIsFetching(true);

    // Create abort controller for this batch
    abortControllerRef.current = new AbortController();

    try {
      while (
        queueRef.current.length > 0 &&
        !abortControllerRef.current.signal.aborted
      ) {
        const wallet = queueRef.current.shift();
        if (!wallet) break;

        // Skip if already fetched
        if (fetchedWalletsRef.current.has(wallet.id)) {
          continue;
        }

        await fetchWalletBalance(wallet);

        // Cooldown between requests (except for the last one)
        if (queueRef.current.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, cooldownMs));
        }
      }
    } catch (error) {
      console.error("Error processing balance queue:", error);
    } finally {
      processingRef.current = false;
      setIsFetching(queueRef.current.length > 0);
    }
  }, [fetchWalletBalance, cooldownMs]);

  useEffect(() => {
    // Wait for wallets to be available
    if (!wallets) {
      return;
    }

    if (wallets.length === 0) {
      setIsFetching(false);
      return;
    }

    // Create a stable reference to wallet IDs for comparison
    const walletIds = wallets.map((w) => w.id).sort().join(",");

    // Check if this is the first time wallets are loaded (lastWalletIdsRef is empty)
    const isFirstLoad = lastWalletIdsRef.current === "";

    // On first load (refresh), clear the fetched wallets set so we refetch balances
    if (isFirstLoad) {
      fetchedWalletsRef.current.clear();
      initializedWalletsRef.current.clear();
    }

    // Only process if wallet IDs have actually changed OR if this is the first load
    if (!isFirstLoad && walletIds === lastWalletIdsRef.current) {
      // Wallets haven't changed, but check if we need to continue processing
      if (!processingRef.current && queueRef.current.length > 0) {
        processQueue().catch((error) => {
          console.error("Error processing balance queue:", error);
          processingRef.current = false;
          setIsFetching(false);
        });
      }
      return;
    }

    lastWalletIdsRef.current = walletIds;

    // First, load any cached balances into local state
    const cached: Record<string, number | null> = {};
    wallets.forEach((wallet) => {
      const cachedData = getCachedBalance(wallet.id);
      if (cachedData) {
        cached[wallet.id] = cachedData.balance;
        setLoadingStates((prev) => ({ ...prev, [wallet.id]: "loaded" }));
        fetchedWalletsRef.current.add(wallet.id);
      }
    });

    if (Object.keys(cached).length > 0) {
      setBalances((prev) => ({ ...prev, ...cached }));
    }

    // Filter out wallets that have already been fetched (either in this session or from cache)
    const walletsToFetch = wallets.filter((wallet) => {
      // Skip if already fetched in this session or from cache
      return !fetchedWalletsRef.current.has(wallet.id);
    });

    if (walletsToFetch.length === 0) {
      setIsFetching(false);
      return;
    }

    // Initialize loading states for new wallets
    walletsToFetch.forEach((wallet) => {
      if (!initializedWalletsRef.current.has(wallet.id)) {
        setLoadingStates((prev) => ({ ...prev, [wallet.id]: "idle" }));
        initializedWalletsRef.current.add(wallet.id);
      }
    });

    // Clear queue and add new wallets (on refresh, we want to refetch)
    queueRef.current = [];
    walletsToFetch.forEach((wallet) => {
      queueRef.current.push(wallet);
    });

    // Start processing if not already processing
    if (!processingRef.current) {
      processQueue().catch((error) => {
        console.error("Error processing balance queue:", error);
        processingRef.current = false;
        setIsFetching(false);
      });
    }

  }, [wallets, processQueue]);

  return {
    balances,
    loadingStates,
    isFetching,
  };
}

