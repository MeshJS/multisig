import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "@/lib/indexeddb";

// Simple proxy state interface
interface ProxyState {
  selectedProxyId: string;
  setSelectedProxy: (proxyId: string) => void;
  clearSelectedProxy: () => void;
}

// Create a simple proxy store
export const useProxyStore = create<ProxyState>()(
  persist(
    (set) => ({
      selectedProxyId: "",
      setSelectedProxy: (proxyId: string) => set({ selectedProxyId: proxyId }),
      clearSelectedProxy: () => set({ selectedProxyId: "" }),
    }),
    {
      name: "proxy-settings",
      storage: createJSONStorage(() => zustandStorage),
    }
  )
);

// Re-export from the main proxy store
export { 
  useProxyData, 
  useSelectedProxy, 
  useProxyActions 
} from "@/lib/zustand/proxy";

// Convenience hook for backward compatibility
export const useProxy = () => {
  const selectedProxyId = useProxyStore((state) => state.selectedProxyId);
  const setSelectedProxy = useProxyStore((state) => state.setSelectedProxy);
  const clearSelectedProxy = useProxyStore((state) => state.clearSelectedProxy);
  
  // Proxy is enabled when a proxy is selected
  const isProxyEnabled = !!selectedProxyId;
  
  // Enhanced clearSelectedProxy with debugging
  const enhancedClearSelectedProxy = () => {
    console.log("useProxy: Clearing selected proxy, current:", selectedProxyId);
    clearSelectedProxy();
    console.log("useProxy: Proxy cleared");
  };
  
  return {
    isProxyEnabled,
    selectedProxyId,
    setSelectedProxy,
    clearSelectedProxy: enhancedClearSelectedProxy,
  };
};
