import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ProxyState {
  isProxyEnabled: boolean;
  selectedProxyId: string;
  toggleProxy: () => void;
  setProxyEnabled: (enabled: boolean) => void;
  setSelectedProxy: (proxyId: string) => void;
  clearSelectedProxy: () => void;
}

export const useProxyStore = create<ProxyState>()(
  persist(
    (set) => ({
      isProxyEnabled: false,
      selectedProxyId: "",
      toggleProxy: () => set((state) => ({ isProxyEnabled: !state.isProxyEnabled })),
      setProxyEnabled: (enabled: boolean) => set({ isProxyEnabled: enabled }),
      setSelectedProxy: (proxyId: string) => set({ selectedProxyId: proxyId }),
      clearSelectedProxy: () => set({ selectedProxyId: "" }),
    }),
    {
      name: "proxy-settings", // unique name for localStorage key
    }
  )
);

// Hook for easy access to proxy state
export const useProxy = () => {
  const { 
    isProxyEnabled, 
    selectedProxyId, 
    toggleProxy, 
    setProxyEnabled, 
    setSelectedProxy, 
    clearSelectedProxy 
  } = useProxyStore();
  
  return {
    isProxyEnabled,
    selectedProxyId,
    toggleProxy,
    setProxyEnabled,
    setSelectedProxy,
    clearSelectedProxy,
  };
};
