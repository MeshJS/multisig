import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Web3Wallet } from "@meshsdk/web3-sdk";

interface UTXOSState {
  // Wallet instance (not persisted - not serializable)
  wallet: Web3Wallet | null;
  setWallet: (wallet: Web3Wallet | null) => void;
  
  // Loading state
  isLoading: boolean;
  setLoading: (loading: boolean) => void;
  
  // Error state
  error: Error | null;
  setError: (error: Error | null) => void;
  
  // Network ID for validation (persisted)
  networkId: number | null;
  setNetworkId: (networkId: number | null) => void;
  
  // Actions
  clearWallet: () => void;
}

export const useUTXOSStore = create<UTXOSState>()(
  persist(
    (set, get) => ({
      wallet: null,
      setWallet: (wallet) => set({ wallet }),
      
      isLoading: false,
      setLoading: (loading) => set({ isLoading: loading }),
      
      error: null,
      setError: (error) => set({ error }),
      
      networkId: null,
      setNetworkId: (networkId) => set({ networkId }),
      
      // Clear wallet and related state
      clearWallet: () => set({
        wallet: null,
        error: null,
        isLoading: false,
        networkId: null,
      }),
    }),
    {
      name: "utxos-state",
      // Only persist networkId, not the wallet instance
      partialize: (state) => ({
        networkId: state.networkId,
      }),
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

// Computed selector for isEnabled
export const useUTXOSIsEnabled = () => useUTXOSStore((state) => state.wallet !== null);

