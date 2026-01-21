import { useEffect } from "react";
import useAppWallet from "@/hooks/useAppWallet";
import { useProxyData, useProxyActions, useProxyStore } from "@/lib/zustand/proxy";
import { useSiteStore } from "@/lib/zustand/site";
import { api } from "@/utils/api";

export default function ProxyDataLoader() {
  const { appWallet } = useAppWallet();
  const network = useSiteStore((state) => state.network);
  const { proxies } = useProxyData(appWallet?.id);
  const { 
    setProxies, 
    fetchProxyBalance, 
    fetchProxyDrepInfo,
    fetchProxyDelegatorsInfo,
    clearProxyData 
  } = useProxyActions();

  

  // Get proxies from API
  const { data: apiProxies, refetch: refetchProxies } = api.proxy.getProxiesByUserOrWallet.useQuery(
    { 
      walletId: appWallet?.id ?? undefined,
    },
    { 
      enabled: !!appWallet?.id,
      refetchOnWindowFocus: false,
      staleTime: 2 * 60 * 1000, // 2 minutes (proxy data changes moderately)
      gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
    }
  );

  // Update store when API data changes
  useEffect(() => {
    if (apiProxies && appWallet?.id) {
      const proxyData = apiProxies.map(proxy => ({
        id: proxy.id,
        proxyAddress: proxy.proxyAddress,
        authTokenId: proxy.authTokenId,
        paramUtxo: proxy.paramUtxo,
        description: proxy.description,
        isActive: proxy.isActive,
        createdAt: new Date(proxy.createdAt),
        lastUpdated: Date.now(),
      }));
      
      setProxies(appWallet.id, proxyData);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiProxies, appWallet?.id]); // setProxies is stable from Zustand, no need to include

  // Fetch additional data for each proxy in parallel
  useEffect(() => {
    if (proxies.length > 0 && appWallet?.id && appWallet?.scriptCbor) {
      void (async () => {
        // Filter proxies that need data refresh
        const staleProxies = proxies.filter(
          (proxy) => !proxy.lastUpdated || (Date.now() - proxy.lastUpdated) > 5 * 60 * 1000
        );

        if (staleProxies.length === 0) return;

        // Fetch all proxy data in parallel
        const fetchPromises = staleProxies.map(async (proxy) => {
          try {
            // Fetch balance and DRep info in parallel for each proxy
            await Promise.all([
              fetchProxyBalance(appWallet.id, proxy.id, proxy.proxyAddress, network.toString()),
              fetchProxyDrepInfo(
                appWallet.id,
                proxy.id,
                proxy.proxyAddress,
                proxy.authTokenId,
                appWallet.scriptCbor,
                network.toString(),
                proxy.paramUtxo,
                true,
              ),
            ]);

            // Check if DRep is registered after fetching DRep info
            // We need to wait a bit for the state to update, then check
            await new Promise((resolve) => setTimeout(resolve, 100));
            const currentProxies = useProxyStore.getState().proxies[appWallet.id] || [];
            const currentProxy = currentProxies.find((p) => p.id === proxy.id);
            
            // Only fetch delegators if DRep is registered
            if (currentProxy?.drepInfo !== null && currentProxy?.drepInfo !== undefined) {
              await fetchProxyDelegatorsInfo(
                appWallet.id,
                proxy.id,
                proxy.proxyAddress,
                proxy.authTokenId,
                appWallet.scriptCbor,
                network.toString(),
                proxy.paramUtxo,
                true,
              );
            } else {
              console.log(`Skipping delegators fetch for proxy ${proxy.id} - DRep not registered`);
            }
          } catch (error) {
            console.error(`Error fetching data for proxy ${proxy.id}:`, error);
            // Continue processing other proxies even if one fails
          }
        });

        // Execute all fetches in parallel
        await Promise.all(fetchPromises);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proxies, appWallet?.id, appWallet?.scriptCbor, network]); // Zustand actions are stable, no need to include them

  // Clear proxy data when wallet changes
  useEffect(() => {
    return () => {
      if (appWallet?.id) {
        clearProxyData(appWallet.id);
      }
    };
  }, [appWallet?.id, clearProxyData]);

  // Expose refetch function for manual refresh
  useEffect(() => {
    // Store refetch function in window for global access if needed
    if (typeof window !== 'undefined') {
      const w = window as Window & { refetchProxyData?: () => void };
      w.refetchProxyData = () => {
        void refetchProxies();
      };
    }
  }, [refetchProxies]);

  return null; // This is a data loader component, no UI
}
