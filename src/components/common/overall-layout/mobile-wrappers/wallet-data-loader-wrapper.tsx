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
  const { fetchProxyBalance, fetchProxyDrepInfo, fetchProxyDelegatorsInfo, setProxies } = useProxyActions();

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
          const transactions: TxInfo[] = await blockchainProvider.get(
            `/addresses/${appWallet.address}/transactions?page=${i}&order=desc`,
          );

          if (transactions.length === 0) {
            break;
          }

          for (const tx of transactions) {
            const txData = await blockchainProvider.get(
              `/txs/${tx.tx_hash}/utxos`,
            );
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
      const blockchainProvider = getProvider(network);
      const assets = await blockchainProvider.get(
        `/addresses/${appWallet?.address}/`,
      );
      const walletAssets: Asset[] = [];
      if (assets.amount) {
        for (const asset of assets.amount) {
          walletAssets.push({
            unit: asset.unit,
            quantity: asset.quantity,
          });
          if (asset.unit === "lovelace") continue;
          const assetInfo = await blockchainProvider.get(
            `/assets/${asset.unit}`,
          );
          setWalletAssetMetadata(
            asset.unit,
            assetInfo?.metadata?.name ||
              assetInfo?.onchain_metadata?.name ||
              assetInfo?.policyId ||
              asset.unit,
            assetInfo?.metadata?.decimals || 0,
            assetInfo?.metadata?.logo ||
              assetInfo?.onchain_metadata?.image ||
              "",
            assetInfo?.metadata?.ticker ||
              assetInfo?.metadata?.name ||
              assetInfo?.onchain_metadata?.name ||
              assetInfo?.policyId ||
              asset.unit,
            assetInfo?.policy_id || "",
          );
        }
        setWalletAssets(walletAssets);
      } else {
        setWalletAssets([]);
      }
    } catch (error) {
      setWalletAssets([]);
      setWalletAssetMetadata("", "", 0, "", "", "");
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

        // Fetch balance and DRep info for each proxy
        for (const proxy of proxies) {
          try {
            
            // Fetch balance
            await fetchProxyBalance(
              appWallet.id, 
              proxy.id, 
              proxy.proxyAddress, 
              network.toString()
            );
            
            // Fetch DRep info with force refresh
            await fetchProxyDrepInfo(
              appWallet.id, 
              proxy.id, 
              proxy.proxyAddress, 
              proxy.authTokenId, 
              appWallet.scriptCbor, 
              network.toString(),
              proxy.paramUtxo,
              true // Force refresh to bypass cache
            );
            
            // Fetch delegators info with force refresh
            await fetchProxyDelegatorsInfo(
              appWallet.id, 
              proxy.id, 
              proxy.proxyAddress, 
              proxy.authTokenId, 
              appWallet.scriptCbor, 
              network.toString(),
              proxy.paramUtxo,
              true // Force refresh to bypass cache
            );
            
          } catch (error) {
            console.error(`WalletDataLoaderWrapper: Error fetching data for proxy ${proxy.id}:`, error);
          }
        }
      } catch (error) {
        console.error("WalletDataLoaderWrapper: Error fetching proxy data:", error);
      }
    }
  }

  async function refreshWallet() {
    if (fetchingTransactions.current) return;

    fetchingTransactions.current = true;
    setLoading(true);
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
    setLoading(false);
    fetchingTransactions.current = false;
    
    // Call the optional callback after action completes
    if (onAction) {
      onAction();
    }
  }

  useEffect(() => {
    if (appWallet && prevWalletIdRef.current !== appWallet.id) {
      refreshWallet();
      prevWalletIdRef.current = appWallet.id;
    } else if (appWallet) {
      // If wallet exists but we already have data, still fetch proxy data
      fetchProxyData();
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
    >
      <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      <span>Refresh Wallet</span>
    </div>
  );
}