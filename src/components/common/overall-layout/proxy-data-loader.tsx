import { useEffect } from "react";
import useAppWallet from "@/hooks/useAppWallet";
import { useProxyData, useProxyActions } from "@/lib/zustand/proxy";
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
      staleTime: 30000, // 30 seconds
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
  }, [apiProxies, appWallet?.id, setProxies]);

  // Fetch additional data for each proxy
  useEffect(() => {
    if (proxies.length > 0 && appWallet?.id && appWallet?.scriptCbor) {
      void (async () => {
        for (const proxy of proxies) {
          // Only fetch if we don't have recent data (older than 5 minutes)
          const isStale = !proxy.lastUpdated || (Date.now() - proxy.lastUpdated) > 5 * 60 * 1000;
          if (isStale) {
            try {
              await fetchProxyBalance(appWallet.id, proxy.id, proxy.proxyAddress, network.toString());
              await fetchProxyDrepInfo(
                appWallet.id,
                proxy.id,
                proxy.proxyAddress,
                proxy.authTokenId,
                appWallet.scriptCbor,
                network.toString(),
                proxy.paramUtxo,
                true,
              );
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
            } catch (error) {
              console.error(`Error fetching data for proxy ${proxy.id}:`, error);
            }
          }
        }
      })();
    }
  }, [proxies, appWallet?.id, appWallet?.scriptCbor, network, fetchProxyBalance, fetchProxyDrepInfo, fetchProxyDelegatorsInfo]);

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
