import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import useAppWallet from "@/hooks/useAppWallet";
import { useEffect, useState } from "react";
import { getProvider } from "@/utils/get-provider";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { api } from "@/utils/api";
import type { OnChainTransaction, TxInfo } from "@/types/transaction";
import { useSiteStore } from "@/lib/zustand/site";
import { useProxyActions } from "@/lib/zustand/proxy";
import type { ProxyData } from "@/lib/zustand/proxy";
import type { UTXO } from "@/types/transaction";

interface TxUtxosResponse {
  inputs: UTXO[];
  outputs: UTXO[];
}

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
  const { fetchAllProxyData, setProxies } = useProxyActions();

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
      // Use standardized IFetcher method
      const txResponse = await blockchainProvider.fetchAddressTxs(appWallet.address);
      // Convert TransactionInfo[] to TxInfo[] format for compatibility
      const transactionsResponse: TxInfo[] = txResponse.map((tx: any) => ({
        tx_hash: tx.hash || tx.tx_hash,
        block_height: tx.block || 0,
        block_time: tx.slot || 0,
        tx_index: tx.index || 0
      }));
      let transactions = transactionsResponse;
      transactions = transactions.reverse().splice(0, 10);
      for (const tx of transactions) {
        // Use standardized IFetcher method
        const utxos = await blockchainProvider.fetchUTxOs(tx.tx_hash);
        // Convert UTxO[] to UTXO[] format for compatibility
        const outputs = utxos.map((utxo: any) => ({
          address: utxo.output.address,
          amount: utxo.output.amount,
          output_index: utxo.input.outputIndex,
          tx_hash: utxo.input.txHash,
          data_hash: utxo.output.dataHash,
          inline_datum: utxo.output.plutusData,
          reference_script_hash: utxo.output.scriptHash,
        }));
        const txData: TxUtxosResponse = { inputs: [], outputs };
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
        }) as ProxyData[];

        console.log("WalletDataLoader: Found proxies", proxies);

        // First, add proxies to the store
        setProxies(appWallet.id, proxies);

        // Fetch all proxy data in parallel using the new batch function
        if (proxies.length > 0) {
          console.log(`WalletDataLoader: Fetching data for ${proxies.length} proxies in parallel`);
          await fetchAllProxyData(
            appWallet.id, 
            proxies, 
            appWallet.scriptCbor, 
            network.toString(),
            false // Use cache to avoid duplicate requests
          );
          console.log("WalletDataLoader: Successfully fetched all proxy data");
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
    // WalletDataLoader useEffect triggered
    
    if (appWallet && walletsUtxos[appWallet?.id] === undefined) {
      console.log("WalletDataLoader: Calling refreshWallet");
      void refreshWallet().catch((error) => {
        console.error("WalletDataLoader: Error in refreshWallet:", error);
      });
    }
  }, [appWallet, walletsUtxos]);

  return (
    <Button
      variant="secondary"
      size="icon"
      className="rounded-full"
      onClick={() => {
        void refreshWallet().catch((error) => {
          console.error("WalletDataLoader: Error in refreshWallet:", error);
        });
      }}
      disabled={loading}
    >
      <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
    </Button>
  );
}
