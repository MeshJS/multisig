import { useCallback, useEffect } from "react";
import { useSiteStore } from "@/lib/zustand/site";
import { useUTXOSStore } from "@/lib/zustand/utxos";
import { env } from "@/env";
import { BlockfrostProvider } from "@meshsdk/provider";
import { Web3Wallet, type EnableWeb3WalletOptions } from "@meshsdk/web3-sdk";
import { useToast } from "./use-toast";

interface UseUTXOSReturn {
  wallet: Web3Wallet | null;
  isEnabled: boolean;
  isLoading: boolean;
  error: Error | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

export default function useUTXOS(): UseUTXOSReturn {
  const network = useSiteStore((state) => state.network);
  const { toast } = useToast();
  
  // Get state from Zustand store
  const wallet = useUTXOSStore((state) => state.wallet);
  const isLoading = useUTXOSStore((state) => state.isLoading);
  const error = useUTXOSStore((state) => state.error);
  const networkId = useUTXOSStore((state) => state.networkId);
  const setWallet = useUTXOSStore((state) => state.setWallet);
  const setLoading = useUTXOSStore((state) => state.setLoading);
  const setError = useUTXOSStore((state) => state.setError);
  const setNetworkId = useUTXOSStore((state) => state.setNetworkId);
  const clearWallet = useUTXOSStore((state) => state.clearWallet);
  
  const isEnabled = wallet !== null;

  const enable = useCallback(async () => {
    // Check if wallet already exists and network matches
    if (wallet && networkId === network) {
      console.log("[useUTXOS] Wallet already enabled for current network");
      return;
    }

    // If network changed, clear existing wallet
    if (wallet && networkId !== null && networkId !== network) {
      console.log("[useUTXOS] Network changed, clearing existing wallet", {
        oldNetwork: networkId,
        newNetwork: network,
      });
      clearWallet();
      toast({
        title: "Network Changed",
        description: "Please reconnect your UTXOS wallet for the new network.",
        variant: "default",
      });
    }

    setLoading(true);
    setError(null);

    try {
      // Get network name for API route
      const networkName = network === 1 ? "mainnet" : "preprod";

      // Initialize BlockfrostProvider with secure proxy route
      const provider = new BlockfrostProvider(
        `/api/blockfrost/${networkName}/`,
      );

      // Configure UTXOS wallet options
      const projectId = env.NEXT_PUBLIC_UTXOS_PROJECT_ID;
      if (!projectId) {
        const errorMsg = "UTXOS Project ID is not configured. Please set NEXT_PUBLIC_UTXOS_PROJECT_ID in your environment variables.";
        console.error("[useUTXOS] Missing project ID");
        toast({
          title: "Configuration Error",
          description: errorMsg,
          variant: "destructive",
        });
        throw new Error(errorMsg);
      }

      const options: EnableWeb3WalletOptions = {
        networkId: network as 0 | 1, // 0: preprod, 1: mainnet
        projectId: projectId,
        fetcher: provider,
        submitter: provider,
      };

      console.log("[useUTXOS] Enabling wallet...");
      // Enable the wallet
      const enabledWallet = await Web3Wallet.enable(options);
      
      // Verify wallet.cardano property exists (per UTXOS docs)
      if (!enabledWallet) {
        console.error("[useUTXOS] enabledWallet is null or undefined");
        throw new Error("UTXOS wallet enabled but returned null/undefined");
      }

      if (!enabledWallet.cardano) {
        console.error("[useUTXOS] enabledWallet.cardano is missing");
        throw new Error("UTXOS wallet enabled but cardano interface not available");
      }

      // Verify wallet is working by checking for addresses
      try {
        const addresses = await enabledWallet.cardano.getUsedAddresses();
        if (!addresses || addresses.length === 0) {
          // Try unused addresses as fallback
          const unusedAddresses = await enabledWallet.cardano.getUnusedAddresses();
          if (!unusedAddresses || unusedAddresses.length === 0) {
            console.warn("[useUTXOS] Wallet enabled but no addresses found");
          }
        }
      } catch (verifyError) {
        console.warn("[useUTXOS] Could not verify wallet addresses:", verifyError);
        // Don't throw - wallet might still be valid, just not fully initialized yet
      }
      
      // Store wallet and network ID
      setWallet(enabledWallet);
      setNetworkId(network);
      console.log("[useUTXOS] Wallet enabled successfully");
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err : new Error(String(err));
      
      console.error("[useUTXOS] Failed to enable wallet:", errorMessage.message);

      setError(errorMessage);
      clearWallet();
      
      // Show user-facing error notification
      toast({
        title: "Failed to Connect UTXOS Wallet",
        description: errorMessage.message || "An unknown error occurred while connecting the wallet.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [network, wallet, networkId, setWallet, setLoading, setError, setNetworkId, clearWallet, toast]);

  const disable = useCallback(async () => {
    try {
      if (wallet) {
        console.log("[useUTXOS] Disabling wallet...");
        await wallet.disable();
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("[useUTXOS] Error disabling UTXOS wallet:", errorMessage);
      
      // Show user-facing error notification
      toast({
        title: "Failed to Disconnect UTXOS Wallet",
        description: errorMessage || "An unknown error occurred while disconnecting the wallet.",
        variant: "destructive",
      });
    } finally {
      clearWallet();
      console.log("[useUTXOS] Wallet disabled");
    }
  }, [wallet, clearWallet, toast]);

  // Handle network changes - clear wallet if network changes while enabled
  useEffect(() => {
    if (isEnabled && wallet && networkId !== null && networkId !== network) {
      console.log("[useUTXOS] Network changed while wallet enabled", {
        oldNetwork: networkId,
        newNetwork: network,
      });
      clearWallet();
      toast({
        title: "Network Changed",
        description: "Please reconnect your UTXOS wallet for the new network.",
        variant: "default",
      });
    }
  }, [network, isEnabled, wallet, networkId, clearWallet, toast]);

  return {
    wallet,
    isEnabled,
    isLoading,
    error,
    enable,
    disable,
  };
}
