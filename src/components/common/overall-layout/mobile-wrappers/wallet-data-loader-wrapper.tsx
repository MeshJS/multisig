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
// WalletAuthModal is now handled in layout.tsx to avoid duplicate prompts
import { useUserStore } from "@/lib/zustand/user";
import { mapWithConcurrency } from "@/utils/concurrency";

/** Blockfrost's page size for list endpoints. */
const BLOCKFROST_PAGE_SIZE = 100;
/**
 * Lookups in flight per wallet refresh. The browser uses the site's public
 * Blockfrost key, shared by every visitor (burst 500, 10 requests/s
 * sustained), so this stays modest: 4 parallel lookups already turn minutes of
 * serial round trips into seconds.
 */
const BLOCKFROST_CONCURRENCY = 4;

/** Mesh's providers reject with a JSON string carrying the HTTP status. */
function isRateLimited(error: unknown): boolean {
  return typeof error === "string" && /"status":\s*429/.test(error);
}

/**
 * GET with a short backoff on 429, so a burst that trips the shared key's
 * rate limit slows down instead of failing the refresh.
 */
async function getWithBackoff(
  provider: { get: (path: string) => Promise<any> }, // eslint-disable-line @typescript-eslint/no-explicit-any
  path: string,
): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const delays = [500, 1500, 4000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await provider.get(path);
    } catch (error) {
      const delay = delays[attempt];
      if (!isRateLimited(error) || delay === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

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

  const userAddress = useUserStore((state) => state.userAddress);

  // Session check is now handled in layout.tsx to avoid duplicate modals
  // Removed walletSessionQuery from here to prevent duplicate authorization prompts

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

        // List pages first (newest first); stop at the first short page.
        const listed: TxInfo[] = [];
        for (let i = 1; i <= maxPage; i++) {
          const transactions: TxInfo[] = await blockchainProvider.get(
            `/addresses/${appWallet.address}/transactions?page=${i}&order=desc`,
          );
          listed.push(...transactions);
          if (transactions.length < BLOCKFROST_PAGE_SIZE) break;
        }

        // Then the per-transaction UTxO lookups, several at a time rather than
        // one round trip after another (up to 400 of them for a busy wallet).
        // Order is preserved, so the list stays newest first.
        // A lookup that still fails after backoff costs only its own detail:
        // the transaction stays in the list with no inputs/outputs, instead of
        // one error emptying the whole history.
        const details = await mapWithConcurrency(
          listed,
          BLOCKFROST_CONCURRENCY,
          (tx) =>
            getWithBackoff(blockchainProvider, `/txs/${tx.tx_hash}/utxos`).catch(
              () => null,
            ),
        );
        listed.forEach((tx, index) => {
          const txData = details[index];
          _transactions.push({
            hash: tx.tx_hash,
            tx: tx,
            inputs: txData?.inputs ?? [],
            outputs: txData?.outputs ?? [],
          });
        });

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
        }
        // Metadata per native asset, fetched concurrently instead of serially.
        const tokens = (assets.amount as { unit: string }[]).filter(
          (asset) => asset.unit !== "lovelace",
        );
        // A failed metadata lookup falls back to the unit, like a token with
        // no registered metadata, rather than dropping every asset.
        const infos = await mapWithConcurrency(
          tokens,
          BLOCKFROST_CONCURRENCY,
          (asset) =>
            getWithBackoff(blockchainProvider, `/assets/${asset.unit}`).catch(
              () => null,
            ),
        );
        for (const [index, asset] of tokens.entries()) {
          const assetInfo = infos[index];
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
    // Use multisig wallet DRep ID if available (it handles no DRep keys by using payment script),
    // otherwise fallback to appWallet (for legacy wallets without multisigWallet)
    const dRepId = multisigWallet ? multisigWallet.getDRepId() : appWallet?.dRepId;
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
    } catch (err: any) {
      // DRep not found (404) is expected if DRep hasn't been registered yet
      // This is normal behavior - the DRep ID exists but isn't registered on-chain
      const is404 = err?.response?.status === 404 || err?.data?.status_code === 404;
      if (!is404) {
        console.error(`Error fetching DRep info:`, err);
      }
      setDrepInfo(undefined);
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
          await fetchAllProxyData(
            appWallet.id, 
            proxies, 
            appWallet.scriptCbor, 
            network.toString(),
            false // Use cache to avoid duplicate requests
          );
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
    // Independent sources — run them together. Each catches its own errors
    // (fetchUtxos aside, which allSettled absorbs), so one slow or failing
    // source no longer holds the others back.
    await Promise.allSettled([
      fetchUtxos(),
      getTransactionsOnChain(),
      getWalletAssets(),
      getDRepInfo(),
      fetchProxyData(),
    ]);
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
    }
  }, [appWallet]);

  // Session check and authorization modal are now handled in layout.tsx
  // This prevents duplicate authorization prompts

  if (mode === "button") {
    return (
      <>
        <Button
          variant="secondary"
          size="icon"
          className="rounded-full"
          onClick={() => refreshWallet()}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        {/* Authorization modal is handled in layout.tsx to avoid duplicate prompts */}
      </>
    );
  }

  // Menu item mode
  return (
    <>
      <div
        className="flex items-center gap-2 cursor-pointer"
        onClick={() => refreshWallet()}
      >
        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        <span>Refresh Wallet</span>
      </div>
      {/* Authorization modal is handled in layout.tsx to avoid duplicate prompts */}
    </>
  );
}