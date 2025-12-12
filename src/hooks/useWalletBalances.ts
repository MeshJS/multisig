import { useEffect, useRef, useState, useCallback } from "react";
import { UTxO } from "@meshsdk/core";
import { Wallet } from "@/types/wallet";
import { getProvider } from "@/utils/get-provider";
import { getBalanceFromUtxos } from "@/utils/getBalance";
import { addressToNetwork } from "@/utils/multisigSDK";
import { buildMultisigWallet } from "@/utils/common";
import { useSiteStore } from "@/lib/zustand/site";

type WalletBalanceState = "idle" | "loading" | "loaded" | "error";

interface UseWalletBalancesResult {
  balances: Record<string, number | null>;
  loadingStates: Record<string, WalletBalanceState>;
  isFetching: boolean;
}

interface UseWalletBalancesOptions {
  cooldownMs?: number;
}

export default function useWalletBalances(
  wallets: Wallet[] | undefined,
  options: UseWalletBalancesOptions = {},
): UseWalletBalancesResult {
  const { cooldownMs = 400 } = options;
  const network = useSiteStore((state) => state.network);
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

  const fetchWalletBalance = useCallback(
    async (wallet: Wallet): Promise<void> => {
      // Skip if already fetched
      if (fetchedWalletsRef.current.has(wallet.id)) {
        return;
      }

      // Mark as loading
      setLoadingStates((prev) => ({ ...prev, [wallet.id]: "loading" }));

      try {
        // Rebuild the multisig wallet to get the correct address
        // This ensures we use the canonical script address, not the potentially wrong wallet.address
        // Determine network from signer addresses or use the current network
        const walletNetwork = wallet.signersAddresses.length > 0 
          ? addressToNetwork(wallet.signersAddresses[0]!)
          : network;
        
        const mWallet = buildMultisigWallet(wallet, walletNetwork);
        if (!mWallet) {
          throw new Error("Failed to build multisig wallet");
        }

        // Get the correct address from the multisig wallet script
        const walletAddress = mWallet.getScript().address;
        
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

        // Update state
        setBalances((prev) => ({ ...prev, [wallet.id]: balance }));
        setLoadingStates((prev) => ({ ...prev, [wallet.id]: "loaded" }));
        fetchedWalletsRef.current.add(wallet.id);
      } catch (error: any) {
        // Handle 404 errors gracefully (address doesn't exist yet - this is normal)
        const is404 = error?.response?.status === 404 || error?.data?.status_code === 404;
        if (!is404) {
          // Only log non-404 errors
          console.error(`Error fetching balance for wallet ${wallet.id}:`, error);
        }
        setBalances((prev) => ({ ...prev, [wallet.id]: null }));
        setLoadingStates((prev) => ({ ...prev, [wallet.id]: "error" }));
        fetchedWalletsRef.current.add(wallet.id); // Mark as attempted to avoid retries
      }
    },
    [],
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

    // Filter out wallets that have already been fetched
    const walletsToFetch = wallets.filter(
      (wallet) => !fetchedWalletsRef.current.has(wallet.id),
    );

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

    // Cleanup on unmount
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [wallets, processQueue]);

  return {
    balances,
    loadingStates,
    isFetching,
  };
}

