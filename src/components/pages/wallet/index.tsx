import PageHeader from "@/components/common/page-header";
import useAppWallet from "@/hooks/useAppWallet";
import { useEffect, useState } from "react";
import { getProvider } from "@/components/common/cardano-objects";
import { NewTransaction } from "./new-transaction";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TabTransactions from "./transactions";
import TabDetails from "./details";
import TabInfo from "./info";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useWalletsStore } from "@/lib/zustand/wallets";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import { Badge } from "@/components/ui/badge";
import { api } from "@/utils/api";
import TabGovernance from "./governance";
import { OnChainTransaction, TxInfo } from "@/types/transaction";
import { useSiteStore } from "@/lib/zustand/site";

export default function PageWallet({ walletId }: { walletId: string }) {
  const { appWallet } = useAppWallet({ walletId });
  const [loading, setLoading] = useState<boolean>(false);
  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);
  const setWalletsUtxos = useWalletsStore((state) => state.setWalletsUtxos);
  const setWalletTransactions = useWalletsStore(
    (state) => state.setWalletTransactions,
  );
  const { transactions } = usePendingTransactions({ walletId });
  const ctx = api.useUtils();
  const network = useSiteStore((state) => state.network);
  const setRandomState = useSiteStore((state) => state.setRandomState);

  async function fetchUtxos() {
    if (appWallet) {
      setWalletsUtxos(walletId, []);
      const blockchainProvider = getProvider(network);
      const utxos = await blockchainProvider.fetchAddressUTxOs(
        appWallet.address,
      );
      setWalletsUtxos(walletId, utxos);
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

      setWalletTransactions(walletId, _transactions);
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
    if (appWallet && walletsUtxos[walletId] === undefined) {
      refreshWallet();
    }
  }, [appWallet]);

  return (
    <>
      {appWallet && (
        <>
          <PageHeader pageTitle={appWallet.name}>
            <NewTransaction walletId={walletId} />
            <Button size="sm" onClick={() => refreshWallet()}>
              <RefreshCw className={`h-4 w-4 ${loading && "animate-spin"}`} />
            </Button>
          </PageHeader>

          <Tabs defaultValue="info">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="info">Info</TabsTrigger>
              <TabsTrigger value="transactions">
                <div className="flex items-center gap-2">
                  Transactions
                  {transactions && transactions.length > 0 && (
                    <Badge className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full">
                      {transactions.length}
                    </Badge>
                  )}
                </div>
              </TabsTrigger>
              <TabsTrigger value="governance">Governance</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
            </TabsList>
            <TabsContent value="info">
              <TabInfo appWallet={appWallet} />
            </TabsContent>
            <TabsContent value="transactions">
              <TabTransactions appWallet={appWallet} />
            </TabsContent>
            <TabsContent value="governance">
              <TabGovernance appWallet={appWallet} />
            </TabsContent>
            <TabsContent value="details">
              <TabDetails appWallet={appWallet} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </>
  );
}
