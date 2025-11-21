import { RefreshCw } from "lucide-react";
import useAppWallet from "@/hooks/useAppWallet";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import { useEffect, useRef, useState } from "react";
import { getProvider } from "@/utils/get-provider";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { api } from "@/utils/api";
import { OnChainTransaction, TxInfo } from "@/types/transaction";
import { useSiteStore } from "@/lib/zustand/site";
import { Asset } from "@meshsdk/core";
import { getDRepIds } from "@meshsdk/core-cst";
import { BlockfrostDrepInfo } from "@/types/governance";
import { Button } from "@/components/ui/button";
import { useProxyActions } from "@/lib/zustand/proxy";

interface WalletDataLoaderWrapperProps {
  mode: "button" | "menu-item";
  onAction?: () => void;
}

export default function WalletDataLoaderWrapper({ 
  mode, 
  onAction 
}: WalletDataLoaderWrapperProps) {
  const { appWallet } = useAppWallet();
  const { multisigWallet } = useMultisigWallet();
  const [loading, setLoading] = useState<boolean>(false);

  const prevWalletIdRef = useRef<string | null>(null);
  const ctx = api.useUtils();
  const network = useSiteStore((state) => state.network);
  const setRandomState = useSiteStore((state) => state.setRandomState);

  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);
  const setWalletsUtxos = useWalletsStore((state) => state.setWalletsUtxos);

  const setWalletTransactions = useWalletsStore(
    (state) => state.setWalletTransactions,
  );
  const fetchingTransactions = useRef(false);

  const walletLastUpdated = useWalletsStore((state) => state.walletLastUpdated);
  const setWalletLastUpdated = useWalletsStore(
    (state) => state.setWalletLastUpdated,
  );

  const setWalletAssets = useWalletsStore((state) => state.setWalletAssets);
  const setWalletAssetMetadata = useWalletsStore(
    (state) => state.setWalletAssetMetadata,
  );
  const { fetchAllProxyData, setProxies } = useProxyActions();

  const setDrepInfo = useWalletsStore((state) => state.setDrepInfo);

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
    try {
      if (appWallet) {
        const maxPage = 4;
        const _transactions: OnChainTransaction[] = [];
        const blockchainProvider = getProvider(network);

        for (let i = 1; i <= maxPage; i++) {
          // Use standardized IFetcher method
          console.log(`Fetching transactions for ${appWallet.address}, page ${i}`);
          const txResponse = await blockchainProvider.fetchAddressTxs(appWallet.address, { 
            page: i, 
            order: 'desc' 
          });
          console.log(`Received ${txResponse.length} transactions for page ${i}`);
          
          // Convert TransactionInfo[] to TxInfo[] format for compatibility
          const transactions: TxInfo[] = txResponse.map((tx: any) => ({
            tx_hash: tx.hash || tx.tx_hash,
            block_height: tx.block || 0,
            block_time: tx.slot || 0,
            tx_index: tx.index || 0
          }));

          if (transactions.length === 0) {
            break;
          }

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
            const txData = { inputs: [], outputs };
            _transactions.push({
              hash: tx.tx_hash,
              tx: tx,
              inputs: txData.inputs,
              outputs: txData.outputs,
            });
          }
        }

        if (_transactions.length > 0) {
          setWalletTransactions(appWallet?.id, _transactions);
        } else {
          setWalletTransactions(appWallet?.id, []);
        }
        setWalletLastUpdated(appWallet?.id, Date.now());
      }
    } catch (error) {
      if (appWallet) {
        setWalletTransactions(appWallet?.id, []);
        setWalletLastUpdated(appWallet?.id, Date.now());
      }
    }
  }

  async function getWalletAssets() {
    try {
      if (!appWallet?.address) {
        return;
      }

      const blockchainProvider = getProvider(network);
      
      // Use standardized IFetcher method - fetchAddressUTxOs to get assets
      console.log(`Fetching UTxOs for ${appWallet.address}`);
      const utxos = await blockchainProvider.fetchAddressUTxOs(appWallet.address);
      console.log(`Received ${utxos.length} UTxOs`);
      
      // Extract unique assets from UTxOs
      const assetMap = new Map<string, string>();
      
      for (const utxo of utxos) {
        for (const amount of utxo.output.amount) {
          const currentQuantity = assetMap.get(amount.unit) || "0";
          const newQuantity = (BigInt(currentQuantity) + BigInt(amount.quantity)).toString();
          assetMap.set(amount.unit, newQuantity);
        }
      }

      const walletAssets: Asset[] = [];
      
      // Convert asset map to Asset array
      for (const [unit, quantity] of assetMap.entries()) {
        walletAssets.push({ unit, quantity });
        
        if (unit === "lovelace") continue;
        
        // Fetch asset metadata using standardized IFetcher method
        try {
          const assetInfo = await blockchainProvider.fetchAssetMetadata(unit);
          setWalletAssetMetadata(
            unit,
            assetInfo?.name || unit,
            assetInfo?.decimals || 0,
            assetInfo?.image || "",
            assetInfo?.ticker || assetInfo?.name || unit,
            assetInfo?.policyId || "",
          );
        } catch (error) {
          console.warn(`Failed to fetch metadata for asset ${unit}:`, error);
        }
      }
      
      setWalletAssets(walletAssets);
    } catch (error) {
      console.error("Error fetching wallet assets:", error);
      setWalletAssets([]);
    }
  }

  function dRepIds() {
    // Use multisig wallet DRep ID if available, otherwise fallback to appWallet
    const dRepId = multisigWallet?.getKeysByRole(3) ? multisigWallet?.getDRepId() : appWallet?.dRepId;
    if (!dRepId) return null;
    return getDRepIds(dRepId);
  }

  async function getDRepInfo() {
    try {
      const drepids = dRepIds();
      if (!drepids) {
        setDrepInfo(undefined);
        return;
      }

      const blockchainProvider = getProvider(network);
      const drepInfo: BlockfrostDrepInfo = await blockchainProvider.get(
        `/governance/dreps/${drepids.cip105}`,
      );
      if (!drepInfo) throw new Error(`No dRep for ID ${drepids.cip105} found.`);
      setDrepInfo(drepInfo);
    } catch (err) {
      // DRep not found (404) is expected if DRep hasn't been registered yet
      // This is normal behavior - the DRep ID exists but isn't registered on-chain
      setDrepInfo(undefined);
      console.log(`DRep not yet registered on-chain (this is normal before registration)`);
    }
  }

  async function fetchProxyData() {
    if (appWallet?.id && appWallet?.scriptCbor) {     
      try {
        // Get proxies from API
        const proxies = await ctx.proxy.getProxiesByUserOrWallet.fetch({
          walletId: appWallet.id,
        });

        // First, add proxies to the store
        setProxies(appWallet.id, proxies);

        // Fetch all proxy data in parallel using the new batch function
        if (proxies.length > 0) {
          console.log(`WalletDataLoaderWrapper: Fetching data for ${proxies.length} proxies in parallel`);
          await fetchAllProxyData(
            appWallet.id, 
            proxies, 
            appWallet.scriptCbor, 
            network.toString(),
            false // Use cache to avoid duplicate requests
          );
          console.log("WalletDataLoaderWrapper: Successfully fetched all proxy data");
        }
      } catch (error) {
        console.error("WalletDataLoaderWrapper: Error fetching proxy data:", error);
      }
    }
  }

  async function refreshWallet() {
    if (fetchingTransactions.current) {
      console.log("WalletDataLoaderWrapper: Already fetching, skipping refresh");
      return;
    }

    console.log("WalletDataLoaderWrapper: Starting wallet refresh");
    fetchingTransactions.current = true;
    setLoading(true);
    
    try {
      await fetchUtxos();
      await getTransactionsOnChain();
      await getWalletAssets();
      await getDRepInfo();
      await fetchProxyData(); // Fetch proxy data
      void ctx.transaction.getPendingTransactions.invalidate();
      void ctx.transaction.getAllTransactions.invalidate();
      // Also refresh proxy data
      void ctx.proxy.getProxiesByUserOrWallet.invalidate();
      setRandomState();
      console.log("WalletDataLoaderWrapper: Wallet refresh completed successfully");
    } catch (error) {
      console.error("WalletDataLoaderWrapper: Error during wallet refresh:", error);
    } finally {
      setLoading(false);
      fetchingTransactions.current = false;
    }
    
    // Call the optional callback after action completes
    if (onAction) {
      onAction();
    }
  }

  useEffect(() => {
    // WalletDataLoaderWrapper useEffect triggered
    
    if (appWallet && prevWalletIdRef.current !== appWallet.id) {
      console.log("WalletDataLoaderWrapper: Calling refreshWallet for wallet change");
      refreshWallet();
      prevWalletIdRef.current = appWallet.id;
    }
  }, [appWallet]);

  if (mode === "button") {
    return (
      <Button
        variant="secondary"
        size="icon"
        className="rounded-full"
        onClick={() => refreshWallet()}
        disabled={loading}
        title="Refresh wallet data"
      >
        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      </Button>
    );
  }

  // Menu item mode
  return (
    <div
      className="flex items-center gap-2 cursor-pointer"
      onClick={() => refreshWallet()}
      title="Refresh wallet data"
    >
      <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      <span>Refresh Wallet</span>
    </div>
  );
}