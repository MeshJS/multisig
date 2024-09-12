import RootLayout from "@/components/common/layout";
import PageHeader from "@/components/common/page-header";
import useWallet from "@/hooks/useWallet";
import { Info, Send } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CardBalance from "./card-balance";
import { useEffect, useState } from "react";
import { getProvider } from "@/components/common/blockfrost";
import { UTxO } from "@meshsdk/core";
import Transactions from "./transactions";
import InspectScript from "./inspect-script";
import { Button } from "@/components/ui/button";
import CardInfo from "./card-info";

export default function PageWallet({ walletId }: { walletId: string }) {
  const { wallet, isLoading } = useWallet({ walletId });
  const [utxos, setUtxos] = useState<UTxO[]>([]);

  useEffect(() => {
    async function fetchUtxos() {
      // if (wallet) { // todo
      const userAddress =
        "addr_test1qp2k7wnshzngpqw0xmy33hvexw4aeg60yr79x3yeeqt3s2uvldqg2n2p8y4kyjm8sqfyg0tpq9042atz0fr8c3grjmysdp6yv3";

      const blockchainProvider = getProvider();
      const utxos = await blockchainProvider.fetchAddressUTxOs(userAddress);
      setUtxos(utxos);

      console.log("utxos", utxos);
      // }
    }
    fetchUtxos();
  }, []);

  return (
    <RootLayout>
      {wallet && (
        <>
          <PageHeader pageTitle={wallet.name}>
            <Button size="sm" asChild>
              New Transaction
            </Button>
          </PageHeader>

          <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
            <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
              <CardBalance utxos={utxos} />
              <Card className="self-start">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Pending Transactions
                  </CardTitle>
                  <Send className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">2</div>
                </CardContent>
              </Card>
              <CardInfo wallet={wallet} />
            </div>
            <div className="grid gap-4 md:gap-8 lg:grid-cols-2 xl:grid-cols-3">
              <Transactions utxos={utxos} address={wallet.address} />
              {/* <Card>
                <CardHeader>
                  <CardTitle>Recent</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-8"></CardContent>
              </Card> */}
            </div>

            <div className="grid gap-4 md:gap-8 lg:grid-cols-2 xl:grid-cols-3">
              <InspectScript nativeScript={wallet.nativeScript} />
            </div>
          </main>
        </>
      )}
    </RootLayout>
  );
}
