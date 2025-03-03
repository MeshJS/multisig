import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import useAppWallet from "@/hooks/useAppWallet";
import { useEffect, useState } from "react";
import { getProvider } from "@/components/common/cardano-objects/get-provider";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { api } from "@/utils/api";
import { OnChainTransaction, TxInfo } from "@/types/transaction";
import { useSiteStore } from "@/lib/zustand/site";
import { NUMBER_OF_TRANSACTIONS } from "@/config/wallet";

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
      const maxPage = 100;
      const _transactions: OnChainTransaction[] = [];
      const blockchainProvider = getProvider(network);

      for (let i = 1; i <= maxPage; i++) {
        let transactions: TxInfo[] = await blockchainProvider.get(
          `/addresses/${appWallet.address}/transactions?page=${i}&order=desc`,
        );

        if (transactions.length === 0) {
          break;
        }

        transactions = transactions.splice(0, NUMBER_OF_TRANSACTIONS);
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

      setWalletTransactions(appWallet?.id, _transactions);
    }
  }

  async function refreshWallet() {
    setLoading(true);
    await fetchUtxos();
    await getTransactionsOnChain();
    void ctx.transaction.getPendingTransactions.invalidate();
    void ctx.transaction.getAllTransactions.invalidate();
    setRandomState();
    setLoading(false);
  }

  useEffect(() => {
    if (appWallet && walletsUtxos[appWallet?.id] === undefined) {
      refreshWallet();
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
      <RefreshCw className={`h-4 w-4 ${loading && "animate-spin"}`} />
    </Button>
  );
}
