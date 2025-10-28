import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import useAppWallet from "@/hooks/useAppWallet";
import { useEffect, useState } from "react";
import { getProvider } from "@/utils/get-provider";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { api } from "@/utils/api";
import { OnChainTransaction, TxInfo } from "@/types/transaction";
import { useSiteStore } from "@/lib/zustand/site";
import { useProxyActions } from "@/lib/zustand/proxy";

export default function WalletDataLoader() {
  const { appWallet } = useAppWallet();
  const [loading, setLoading] = useState<boolean>(false);
  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);
  const setWalletsUtxos = useWalletsStore((state) => state.setWalletsUtxos);
  const setWalletTransactions = useWalletsStore(
    (state) => state.setWalletTransactions,
  );
  const ctx = api.useUtils();
  const network = useSiteStore((state) => state.network);
  const setRandomState = useSiteStore((state) => state.setRandomState);
  const { fetchProxyBalance, fetchProxyDrepInfo, setProxies } = useProxyActions();

  async function fetchUtxos() {
    if (appWallet) {
      setWalletsUtxos(appWallet?.id, []);
      const blockchainProvider = getProvider(network);
      const utxos = await blockchainProvider.fetchAddressUTxOs(
        appWallet.address,
      );
      setWalletsUtxos(appWallet?.id, utxos);
    }
  }

  async function getTransactionsOnChain() {
    if (appWallet) {
      const _transactions: OnChainTransaction[] = [];
      const blockchainProvider = getProvider(network);
      let transactions: TxInfo[] = await blockchainProvider.get(
        `/addresses/${appWallet.address}/transactions`,
      );
      transactions = transactions.reverse().splice(0, 10);
      for (const tx of transactions) {
        const txData = await blockchainProvider.get(`/txs/${tx.tx_hash}/utxos`);
        _transactions.push({
          hash: tx.tx_hash,
          tx: tx,
          inputs: txData.inputs,
          outputs: txData.outputs,
        });
      }

      setWalletTransactions(appWallet?.id, _transactions);
    }
  }

  async function fetchProxyData() {
    if (appWallet?.id && appWallet?.scriptCbor) {
      console.log("WalletDataLoader: Fetching proxy data for wallet", appWallet.id);
      
      try {
        // Get proxies from API
        const proxies = await ctx.proxy.getProxiesByUserOrWallet.fetch({
          walletId: appWallet.id,
        });

        console.log("WalletDataLoader: Found proxies", proxies);

        // First, add proxies to the store
        setProxies(appWallet.id, proxies);

        // Fetch balance and DRep info for each proxy
        for (const proxy of proxies) {
          try {
            console.log(`WalletDataLoader: Fetching data for proxy ${proxy.id}`);
            
            // Fetch balance
            await fetchProxyBalance(
              appWallet.id, 
              proxy.id, 
              proxy.proxyAddress, 
              network.toString()
            );
            
            // Fetch DRep info
            await fetchProxyDrepInfo(
              appWallet.id, 
              proxy.id, 
              proxy.proxyAddress, 
              proxy.authTokenId, 
              appWallet.scriptCbor, 
              network.toString(),
              proxy.paramUtxo
            );
            
            console.log(`WalletDataLoader: Successfully fetched data for proxy ${proxy.id}`);
          } catch (error) {
            console.error(`WalletDataLoader: Error fetching data for proxy ${proxy.id}:`, error);
          }
        }
      } catch (error) {
        console.error("WalletDataLoader: Error fetching proxy data:", error);
      }
    }
  }

  async function refreshWallet() {
    console.log("WalletDataLoader: refreshWallet called");
    setLoading(true);
    await fetchUtxos();
    await getTransactionsOnChain();
    console.log("WalletDataLoader: About to fetch proxy data");
    await fetchProxyData(); // Fetch proxy data
    console.log("WalletDataLoader: Finished fetching proxy data");
    void ctx.transaction.getPendingTransactions.invalidate();
    void ctx.transaction.getAllTransactions.invalidate();
    // Also refresh proxy data
    void ctx.proxy.getProxiesByUserOrWallet.invalidate();
    setRandomState();
    setLoading(false);
  }

  useEffect(() => {
    console.log("WalletDataLoader: useEffect triggered", {
      hasAppWallet: !!appWallet,
      walletId: appWallet?.id,
      hasUtxos: appWallet?.id ? walletsUtxos[appWallet.id] !== undefined : false
    });
    
    if (appWallet && walletsUtxos[appWallet?.id] === undefined) {
      console.log("WalletDataLoader: Calling refreshWallet");
      refreshWallet();
    } else if (appWallet) {
      // If wallet exists but we already have UTxOs, still fetch proxy data
      console.log("WalletDataLoader: Calling fetchProxyData directly");
      fetchProxyData();
    }
  }, [appWallet]);

  return (
    <Button
      variant="secondary"
      size="icon"
      className="rounded-full"
      onClick={() => refreshWallet()}
      disabled={loading}
    >
      <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
    </Button>
  );
}
