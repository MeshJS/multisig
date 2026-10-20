import { RefreshCw } from "lucide-react";
import useAppWallet from "@/hooks/useAppWallet";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import { useEffect, useState } from "react";
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
import { createBlockfrostThrottle } from "@/utils/blockfrost-throttle";
import {
  type RefreshContext,
  walletRefreshCoordinator,
} from "@/lib/wallet-refresh";

type BlockfrostThrottle = ReturnType<typeof createBlockfrostThrottle>;

/** Blockfrost's page size for list endpoints. */
const BLOCKFROST_PAGE_SIZE = 100;
/**
 * Lookups in flight per wallet refresh. The throttle caps throughput
 * separately, at 5 requests/s: about what the old serial loop made, and half
 * of Blockfrost's sustained limit. Concurrency only has to keep the throttle
 * busy across slow round trips.
 */
const BLOCKFROST_CONCURRENCY = 4;

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

  const ctx = api.useUtils();
  const network = useSiteStore((state) => state.network);
  const setRandomState = useSiteStore((state) => state.setRandomState);

  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);
  const setWalletsUtxos = useWalletsStore((state) => state.setWalletsUtxos);

  const setWalletTransactions = useWalletsStore(
    (state) => state.setWalletTransactions,
  );

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

  async function getTransactionsOnChain(
    throttle: BlockfrostThrottle,
    refresh: RefreshContext,
  ) {
    try {
      if (appWallet) {
        const maxPage = 4;
        const _transactions: OnChainTransaction[] = [];
        const blockchainProvider = getProvider(network);

        // List pages first (newest first); stop at the first short page.
        const listed: TxInfo[] = [];
        for (let i = 1; i <= maxPage; i++) {
          if (refresh.isStale()) return;
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
            // The user moved to another wallet: stop spending rate budget on
            // this one. What was fetched is discarded below.
            refresh.isStale()
              ? Promise.resolve(null)
              : throttle
                  .get(blockchainProvider, `/txs/${tx.tx_hash}/utxos`)
                  .catch(() => null),
        );
        // A history cut short by a wallet switch would replace the cached one
        // with transactions missing their inputs and outputs. Keep the cache;
        // switching back to this wallet loads it again.
        if (refresh.isStale()) return;
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
      if (appWallet && !refresh.isStale()) {
        setWalletTransactions(appWallet?.id, []);
        setWalletLastUpdated(appWallet?.id, Date.now());
      }
    }
  }

  async function getWalletAssets(
    throttle: BlockfrostThrottle,
    refresh: RefreshContext,
  ) {
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
            refresh.isStale()
              ? Promise.resolve(null)
              : throttle
                  .get(blockchainProvider, `/assets/${asset.unit}`)
                  .catch(() => null),
        );
        // `walletAssets` is not keyed by wallet: written now, it would show
        // the previous wallet's assets on the one the user switched to. The
        // metadata is keyed by unit, but lookups skipped above would replace
        // known names with the bare unit.
        if (refresh.isStale()) return;
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
      if (refresh.isStale()) return;
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

  async function getDRepInfo(refresh: RefreshContext) {
    try {
      const drepids = dRepIds();
      if (!drepids) {
        if (!refresh.isStale()) setDrepInfo(undefined);
        return;
      }

      const blockchainProvider = getProvider(network);
      const drepInfo: BlockfrostDrepInfo = await blockchainProvider.get(
        `/governance/dreps/${drepids.cip105}`,
      );
      if (!drepInfo) throw new Error(`No dRep for ID ${drepids.cip105} found.`);
      // `drepInfo` is not keyed by wallet either; see getWalletAssets.
      if (refresh.isStale()) return;
      setDrepInfo(drepInfo);
    } catch (err: any) {
      // DRep not found (404) is expected if DRep hasn't been registered yet
      // This is normal behavior - the DRep ID exists but isn't registered on-chain
      const is404 = err?.response?.status === 404 || err?.data?.status_code === 404;
      if (!is404) {
        console.error(`Error fetching DRep info:`, err);
      }
      if (refresh.isStale()) return;
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

  /** Load one wallet's chain data into the store. */
  async function loadWallet(refresh: RefreshContext) {
    // Independent sources — run them together. Each catches its own errors
    // (fetchUtxos aside, which allSettled absorbs), so one slow or failing
    // source no longer holds the others back.
    // One throttle per refresh, shared by both fan-outs, so together they stay
    // under Blockfrost's per-client rate and leave room for the calls a
    // transaction build makes meanwhile.
    const throttle = createBlockfrostThrottle({ minIntervalMs: 200 });
    await Promise.allSettled([
      fetchUtxos(),
      getTransactionsOnChain(throttle, refresh),
      getWalletAssets(throttle, refresh),
      getDRepInfo(refresh),
      fetchProxyData(),
    ]);
  }

  async function refreshWallet() {
    setLoading(true);
    try {
      // Shared across both mounted controls: a refresh already running for
      // this wallet is joined, not repeated (see src/lib/wallet-refresh.ts).
      // With no wallet open there is no chain data to load, only queries.
      if (appWallet) {
        await walletRefreshCoordinator.run(appWallet.id, loadWallet);
      }
      void ctx.transaction.getPendingTransactions.invalidate();
      void ctx.transaction.getAllTransactions.invalidate();
      // Also refresh proxy data
      void ctx.proxy.getProxiesByUserOrWallet.invalidate();
      setRandomState();
    } finally {
      setLoading(false);
    }

    // Call the optional callback after action completes
    if (onAction) {
      onAction();
    }
  }

  const appWalletId = appWallet?.id;
  useEffect(() => {
    if (!appWalletId) return;
    // Load on a wallet switch, not on every mount: the mobile menu's copy of
    // this control mounts each time the menu opens. If a refresh is already
    // running, join it so this copy's spinner reflects it.
    if (
      walletRefreshCoordinator.showWallet(appWalletId) ||
      walletRefreshCoordinator.isRunning(appWalletId)
    ) {
      void refreshWallet();
    }
    // Keyed on the id: appWallet is rebuilt whenever its UTxOs change, which
    // the refresh itself does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appWalletId]);

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