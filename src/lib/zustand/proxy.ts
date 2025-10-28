import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "../indexeddb";
import { MeshProxyContract } from "@/components/multisig/proxy/offchain";
import { getTxBuilder } from "@/utils/get-tx-builder";
import { useSiteStore } from "./site";

// Types for proxy data
export interface ProxyDrepInfo {
  active: boolean;
  amount: string;
  deposit: string;
  url?: string;
  hash?: string;
}

export interface DelegatorInfo {
  address: string;
  amount: string;
}

export interface ProxyDelegatorsInfo {
  delegators: DelegatorInfo[];
  totalDelegation: string;
  totalDelegationADA: number;
  count: number;
}

export interface ProxyData {
  id: string;
  proxyAddress: string;
  authTokenId: string;
  paramUtxo: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  balance?: Array<{ unit: string; quantity: string }>;
  drepId?: string;
  drepInfo?: ProxyDrepInfo;
  delegatorsInfo?: ProxyDelegatorsInfo;
  lastUpdated?: number;
}

interface ProxyState {
  // Proxy data
  proxies: { [walletId: string]: ProxyData[] };
  selectedProxyId: string;
  isProxyEnabled: boolean;
  
  // Loading states
  loading: { [walletId: string]: boolean };
  drepLoading: { [proxyId: string]: boolean };
  
  // Error states
  errors: { [walletId: string]: string | null };
  drepErrors: { [proxyId: string]: string | null };
  
  // Actions
  setProxies: (walletId: string, proxies: ProxyData[]) => void;
  setSelectedProxy: (proxyId: string) => void;
  setProxyEnabled: (enabled: boolean) => void;
  toggleProxy: () => void;
  clearSelectedProxy: () => void;
  
  // Loading actions
  setLoading: (walletId: string, loading: boolean) => void;
  setDrepLoading: (proxyId: string, loading: boolean) => void;
  
  // Error actions
  setError: (walletId: string, error: string | null) => void;
  setDrepError: (proxyId: string, error: string | null) => void;
  
  // Data fetching actions
  fetchProxyBalance: (walletId: string, proxyId: string, proxyAddress: string, network: string) => Promise<void>;
  fetchProxyDrepInfo: (walletId: string, proxyId: string, proxyAddress: string, authTokenId: string, scriptCbor: string, network: string, paramUtxo: string, forceRefresh?: boolean) => Promise<void>;
  fetchProxyDelegatorsInfo: (walletId: string, proxyId: string, proxyAddress: string, authTokenId: string, scriptCbor: string, network: string, paramUtxo: string, forceRefresh?: boolean) => Promise<void>;
  
  // Utility actions
  updateProxyData: (walletId: string, proxyId: string, updates: Partial<ProxyData>) => void;
  clearProxyData: (walletId: string) => void;
}

export const useProxyStore = create<ProxyState>()(
  persist(
    (set, get) => ({
      // Initial state
      proxies: {},
      selectedProxyId: "",
      isProxyEnabled: false,
      loading: {},
      drepLoading: {},
      errors: {},
      drepErrors: {},
      
      // Basic actions
      setProxies: (walletId, proxies) =>
        set((state) => ({
          proxies: { ...state.proxies, [walletId]: proxies },
          loading: { ...state.loading, [walletId]: false },
          errors: { ...state.errors, [walletId]: null },
        })),
      
      setSelectedProxy: (proxyId) =>
        set({ selectedProxyId: proxyId }),
      
      setProxyEnabled: (enabled) =>
        set({ isProxyEnabled: enabled }),
      
      toggleProxy: () =>
        set((state) => ({ isProxyEnabled: !state.isProxyEnabled })),
      
      clearSelectedProxy: () =>
        set({ selectedProxyId: "" }),
      
      // Loading actions
      setLoading: (walletId, loading) =>
        set((state) => ({
          loading: { ...state.loading, [walletId]: loading },
        })),
      
      setDrepLoading: (proxyId, loading) =>
        set((state) => ({
          drepLoading: { ...state.drepLoading, [proxyId]: loading },
        })),
      
      // Error actions
      setError: (walletId, error) =>
        set((state) => ({
          errors: { ...state.errors, [walletId]: error },
        })),
      
      setDrepError: (proxyId, error) =>
        set((state) => ({
          drepErrors: { ...state.drepErrors, [proxyId]: error },
        })),
      
      // Fetch proxy balance
      fetchProxyBalance: async (walletId, proxyId, proxyAddress, network) => {
        try {
          const state = get();
          const blockchainProvider = (await import("@/utils/get-provider")).getProvider(parseInt(network));
          
          const balance = await blockchainProvider.fetchAddressUTxOs(proxyAddress);
          const balanceData = balance.map(utxo => ({
            unit: utxo.output.amount[0]?.unit || "lovelace",
            quantity: utxo.output.amount[0]?.quantity || "0",
          }));
          
          // Update the specific proxy's balance
          const currentState = get();
          const updatedProxies = currentState.proxies[walletId]?.map(proxy => 
            proxy.id === proxyId 
              ? { ...proxy, balance: balanceData, lastUpdated: Date.now() }
              : proxy
          ) || [];

          set((state) => ({
            proxies: { ...state.proxies, [walletId]: updatedProxies },
          }));
        } catch (error) {
          get().setError(walletId, `Failed to fetch balance for proxy ${proxyId}`);
        }
      },
      
      // Fetch proxy DRep information
      fetchProxyDrepInfo: async (walletId, proxyId, proxyAddress, authTokenId, scriptCbor, network, paramUtxo, forceRefresh = false) => {
        try {
          get().setDrepLoading(proxyId, true);
          get().setDrepError(proxyId, null);
          
          const txBuilder = getTxBuilder(parseInt(network));
          const proxyContract = new MeshProxyContract(
            {
              mesh: txBuilder,
              wallet: undefined,
              networkId: parseInt(network),
            },
            {
              paramUtxo: JSON.parse(paramUtxo || '{}'),
            },
            scriptCbor,
          );
          proxyContract.proxyAddress = proxyAddress;
          
          // Get DRep ID
          const drepId = proxyContract.getDrepId();
          
          // Get DRep status (now with caching and proper error handling)
          const status = await proxyContract.getDrepStatus(forceRefresh);
          const drepInfo: ProxyDrepInfo | undefined = status;
          
          // Update the specific proxy's DRep data
          const currentState = get();
          const updatedProxies = currentState.proxies[walletId]?.map(proxy => 
            proxy.id === proxyId 
              ? { ...proxy, drepId, drepInfo, lastUpdated: Date.now() }
              : proxy
          ) || [];
          
          set((state) => ({
            proxies: { ...state.proxies, [walletId]: updatedProxies },
            drepLoading: { ...state.drepLoading, [proxyId]: false },
            drepErrors: { ...state.drepErrors, [proxyId]: null },
          }));
        } catch (error) {
          get().setDrepError(proxyId, `Failed to fetch DRep info for proxy ${proxyId}`);
          get().setDrepLoading(proxyId, false);
        }
      },

      // Fetch proxy delegators information
      fetchProxyDelegatorsInfo: async (walletId, proxyId, proxyAddress, authTokenId, scriptCbor, network, paramUtxo, forceRefresh = false) => {
        try {
          get().setDrepLoading(proxyId, true);
          get().setDrepError(proxyId, null);
          
          const txBuilder = getTxBuilder(parseInt(network));
          const proxyContract = new MeshProxyContract(
            {
              mesh: txBuilder,
              wallet: undefined,
              networkId: parseInt(network),
            },
            {
              paramUtxo: JSON.parse(paramUtxo || '{}'),
            },
            scriptCbor,
          );
          proxyContract.proxyAddress = proxyAddress;
          
          // Get delegators info
          const delegatorsInfo = await proxyContract.getDrepDelegators(forceRefresh) as ProxyDelegatorsInfo;
          
          // Update the specific proxy's delegators data
          const currentState = get();
          const updatedProxies = currentState.proxies[walletId]?.map(proxy => 
            proxy.id === proxyId 
              ? { ...proxy, delegatorsInfo, lastUpdated: Date.now() }
              : proxy
          ) || [];
          
          set((state) => ({
            proxies: { ...state.proxies, [walletId]: updatedProxies },
            drepLoading: { ...state.drepLoading, [proxyId]: false },
            drepErrors: { ...state.drepErrors, [proxyId]: null },
          }));
        } catch (error) {
          get().setDrepError(proxyId, `Failed to fetch delegators info for proxy ${proxyId}`);
          get().setDrepLoading(proxyId, false);
        }
      },
      
      // Update specific proxy data
      updateProxyData: (walletId, proxyId, updates) =>
        set((state) => ({
          proxies: {
            ...state.proxies,
            [walletId]: state.proxies[walletId]?.map(proxy =>
              proxy.id === proxyId ? { ...proxy, ...updates } : proxy
            ) || [],
          },
        })),
      
      // Clear all proxy data for a wallet
      clearProxyData: (walletId) =>
        set((state) => {
          const newProxies = { ...state.proxies };
          delete newProxies[walletId];
          const newLoading = { ...state.loading };
          delete newLoading[walletId];
          const newErrors = { ...state.errors };
          delete newErrors[walletId];
          
          return {
            proxies: newProxies,
            loading: newLoading,
            errors: newErrors,
          };
        }),
    }),
    {
      name: "proxy-store",
      storage: createJSONStorage(() => zustandStorage),
      // Only persist essential state, not loading/error states
      partialize: (state) => ({
        proxies: state.proxies,
        selectedProxyId: state.selectedProxyId,
        isProxyEnabled: state.isProxyEnabled,
      }),
    }
  )
);

// Convenience hooks for easier access
export const useProxyData = (walletId?: string) => {
  const proxies = useProxyStore((state) => walletId ? state.proxies[walletId] || [] : []);
  const loading = useProxyStore((state) => walletId ? state.loading[walletId] || false : false);
  const error = useProxyStore((state) => walletId ? state.errors[walletId] || null : null);
  
  return { proxies, loading, error };
};

export const useSelectedProxy = () => {
  const selectedProxyId = useProxyStore((state) => state.selectedProxyId);
  const isProxyEnabled = useProxyStore((state) => state.isProxyEnabled);
  const proxies = useProxyStore((state) => state.proxies);
  
  // Find the selected proxy across all wallets
  let selectedProxy: ProxyData | undefined;
  for (const walletProxies of Object.values(proxies)) {
    selectedProxy = walletProxies.find(proxy => proxy.id === selectedProxyId);
    if (selectedProxy) break;
  }
  
  return { selectedProxy, selectedProxyId, isProxyEnabled };
};

export const useProxyActions = () => {
  const setProxies = useProxyStore((state) => state.setProxies);
  const setSelectedProxy = useProxyStore((state) => state.setSelectedProxy);
  const setProxyEnabled = useProxyStore((state) => state.setProxyEnabled);
  const toggleProxy = useProxyStore((state) => state.toggleProxy);
  const clearSelectedProxy = useProxyStore((state) => state.clearSelectedProxy);
  const fetchProxyBalance = useProxyStore((state) => state.fetchProxyBalance);
  const fetchProxyDrepInfo = useProxyStore((state) => state.fetchProxyDrepInfo);
  const fetchProxyDelegatorsInfo = useProxyStore((state) => state.fetchProxyDelegatorsInfo);
  const updateProxyData = useProxyStore((state) => state.updateProxyData);
  const clearProxyData = useProxyStore((state) => state.clearProxyData);
  
  return {
    setProxies,
    setSelectedProxy,
    setProxyEnabled,
    toggleProxy,
    clearSelectedProxy,
    fetchProxyBalance,
    fetchProxyDrepInfo,
    fetchProxyDelegatorsInfo,
    updateProxyData,
    clearProxyData,
  };
};
