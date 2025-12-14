import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "../indexeddb";

interface WalletBalanceCache {
  balance: number | null; // null means error, 0 means unused address (404)
  timestamp: number; // When the balance was fetched
  address: string; // The wallet address used for the fetch
}

interface State {
  // Cache balances by wallet ID
  balances: { [walletId: string]: WalletBalanceCache };
  
  // Set balance for a wallet
  setBalance: (walletId: string, balance: number | null, address: string) => void;
  
  // Get balance from cache (returns null if not cached or expired)
  getCachedBalance: (walletId: string, maxAge?: number) => WalletBalanceCache | null;
  
  // Clear balance for a wallet (force refetch)
  clearBalance: (walletId: string) => void;
  
  // Clear all balances
  clearAllBalances: () => void;
  
  // Clear expired balances (older than maxAge)
  clearExpiredBalances: (maxAge?: number) => void;
}

// Default cache duration: 5 minutes
const DEFAULT_CACHE_DURATION = 5 * 60 * 1000;

export const useWalletBalancesStore = create<State>()(
  persist(
    (set, get) => ({
      balances: {},
      
      setBalance: (walletId, balance, address) =>
        set((state) => ({
          balances: {
            ...state.balances,
            [walletId]: {
              balance,
              timestamp: Date.now(),
              address,
            },
          },
        })),
      
      getCachedBalance: (walletId, maxAge = DEFAULT_CACHE_DURATION) => {
        const state = get();
        const cached = state.balances[walletId];
        
        if (!cached) {
          return null;
        }
        
        // Check if cache is expired
        const age = Date.now() - cached.timestamp;
        if (age > maxAge) {
          return null;
        }
        
        return cached;
      },
      
      clearBalance: (walletId) =>
        set((state) => {
          const { [walletId]: _, ...rest } = state.balances;
          return { balances: rest };
        }),
      
      clearAllBalances: () => set({ balances: {} }),
      
      clearExpiredBalances: (maxAge = DEFAULT_CACHE_DURATION) => {
        const state = get();
        const now = Date.now();
        const validBalances = Object.fromEntries(
          Object.entries(state.balances).filter(
            ([_, cache]) => now - cache.timestamp <= maxAge
          )
        );
        // Only update if there are actually expired entries to remove
        if (Object.keys(validBalances).length !== Object.keys(state.balances).length) {
          set({ balances: validBalances });
        }
      },
    }),
    {
      name: "wallet-balances-cache",
      storage: createJSONStorage(() => zustandStorage),
      // Only persist balances, not the functions
      partialize: (state) => ({ balances: state.balances }),
    }
  )
);

