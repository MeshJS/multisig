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

        console.log(`Fetching balance for wallet ${wallet.id} (${walletAddress.slice(0, 20)}...)`);

        // Fetch address info using Blockfrost API
        // This returns an object with an 'amount' array containing assets
        const addressInfo = await provider.get(`/addresses/${walletAddress}/`);

        console.log(`Fetched address info for wallet ${wallet.id}`, addressInfo);

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
            console.log(`Found lovelace asset: ${lovelaceAmount} lovelace = ${balance} ADA`);
          } else {
            console.log(`No lovelace asset found in address info for wallet ${wallet.id}`);
          }
        } else {
          console.warn(`Invalid address info format for wallet ${wallet.id}:`, addressInfo);
        }

        console.log(`Final balance for wallet ${wallet.id}: ${balance} ADA`);

        // Update state
        setBalances((prev) => ({ ...prev, [wallet.id]: balance }));
        setLoadingStates((prev) => ({ ...prev, [wallet.id]: "loaded" }));
        fetchedWalletsRef.current.add(wallet.id);
      } catch (error) {
        console.error(`Error fetching balance for wallet ${wallet.id}:`, error);
        setBalances((prev) => ({ ...prev, [wallet.id]: null }));
        setLoadingStates((prev) => ({ ...prev, [wallet.id]: "error" }));
        fetchedWalletsRef.current.add(wallet.id); // Mark as attempted to avoid retries
      }
    },
    [],
  );

  const processQueue = useCallback(async () => {
    if (processingRef.current) {
      console.log("Queue processing already in progress");
      return;
    }

    if (queueRef.current.length === 0) {
      console.log("Queue is empty, stopping fetch");
      setIsFetching(false);
      return;
    }

    console.log(`Starting to process ${queueRef.current.length} wallets`);
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
          console.log(`Skipping wallet ${wallet.id} - already fetched`);
          continue;
        }

        console.log(`Processing wallet ${wallet.id} from queue`);
        await fetchWalletBalance(wallet);

        // Cooldown between requests (except for the last one)
        if (queueRef.current.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, cooldownMs));
        }
      }
      console.log("Finished processing queue");
    } finally {
      processingRef.current = false;
      setIsFetching(queueRef.current.length > 0);
    }
  }, [fetchWalletBalance, cooldownMs]);

  useEffect(() => {
    // Wait for wallets to be available
    if (!wallets) {
      console.log("Wallets not yet loaded, waiting...");
      return;
    }

    if (wallets.length === 0) {
      console.log("No wallets provided to useWalletBalances");
      setIsFetching(false);
      return;
    }

    console.log(`useWalletBalances effect: ${wallets.length} wallets provided`);

    // Create a stable reference to wallet IDs for comparison
    const walletIds = wallets.map((w) => w.id).sort().join(",");

    // Check if this is the first time wallets are loaded (lastWalletIdsRef is empty)
    const isFirstLoad = lastWalletIdsRef.current === "";

    // On first load (refresh), clear the fetched wallets set so we refetch balances
    if (isFirstLoad) {
      console.log("First load detected, clearing fetched wallets cache");
      fetchedWalletsRef.current.clear();
      initializedWalletsRef.current.clear();
    }

    // Only process if wallet IDs have actually changed OR if this is the first load
    if (!isFirstLoad && walletIds === lastWalletIdsRef.current) {
      console.log("Wallet IDs unchanged, checking if queue needs processing");
      // Wallets haven't changed, but check if we need to continue processing
      if (!processingRef.current && queueRef.current.length > 0) {
        console.log("Resuming queue processing");
        processQueue().catch((error) => {
          console.error("Error processing balance queue:", error);
          processingRef.current = false;
          setIsFetching(false);
        });
      }
      return;
    }

    console.log(isFirstLoad ? "First load, processing wallets" : "Wallet IDs changed, processing new wallets");
    lastWalletIdsRef.current = walletIds;

    // Filter out wallets that have already been fetched
    const walletsToFetch = wallets.filter(
      (wallet) => !fetchedWalletsRef.current.has(wallet.id),
    );

    console.log(`${walletsToFetch.length} wallets need balance fetching`);

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

    console.log(`Added ${walletsToFetch.length} wallets to queue. Queue length: ${queueRef.current.length}`);

    // Start processing if not already processing
    if (!processingRef.current) {
      console.log("Starting queue processing");
      processQueue().catch((error) => {
        console.error("Error processing balance queue:", error);
        processingRef.current = false;
        setIsFetching(false);
      });
    } else {
      console.log("Queue processing already in progress, skipping");
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

