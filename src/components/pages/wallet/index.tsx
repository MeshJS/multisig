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

export default function PageWallet({ walletId }: { walletId: string }) {
  const { appWallet, isLoading } = useAppWallet({ walletId });
  const [loading, setLoading] = useState<boolean>(false);
  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);
  const setWalletsUtxos = useWalletsStore((state) => state.setWalletsUtxos);
  const { transactions } = usePendingTransactions({ walletId });

  async function fetchUtxos() {
    if (appWallet) {
      setWalletsUtxos(walletId, []);
      const blockchainProvider = getProvider();
      const utxos = await blockchainProvider.fetchAddressUTxOs(
        appWallet.address,
      );
      setWalletsUtxos(walletId, utxos);
    }
  }

  async function refreshWallet() {
    setLoading(true);
    await fetchUtxos();
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
                Transactions
                {transactions && transactions.length > 0 && (
                  <Badge className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full">
                    {transactions.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="governance">Governance</TabsTrigger>
            </TabsList>
            <TabsContent value="info">
              <TabInfo appWallet={appWallet} />
            </TabsContent>
            <TabsContent value="transactions">
              <TabTransactions appWallet={appWallet} />
            </TabsContent>
            <TabsContent value="details">
              <TabDetails appWallet={appWallet} />
            </TabsContent>
            <TabsContent value="governance">
              <p>Coming soon...</p>
            </TabsContent>
          </Tabs>
        </>
      )}
    </>
  );
}
