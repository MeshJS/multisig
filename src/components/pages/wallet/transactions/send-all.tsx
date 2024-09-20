import { Loader, Send } from "lucide-react";
import { Wallet } from "@/types/wallet";
import CardUI from "@/components/common/card-content";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useWallet } from "@meshsdk/react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { api } from "@/utils/api";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "@/lib/zustand/user";
import { getProvider, getTxBuilder } from "@/components/common/cardano-objects";
import { useSiteStore } from "@/lib/zustand/site";
import { Asset } from "@meshsdk/core";

export default function CardSendAll({ appWallet }: { appWallet: Wallet }) {
  const { wallet, connected } = useWallet();
  const [loading, setLoading] = useState<boolean>(false);
  const [recipientAddress, setRecipientAddress] = useState<string>("");
  const ctx = api.useUtils();
  const { toast } = useToast();
  const userAddress = useUserStore((state) => state.userAddress);
  const network = useSiteStore((state) => state.network);

  const { mutate: createTransaction } =
    api.transaction.createTransaction.useMutation({
      onSuccess: async () => {
        setLoading(false);
        toast({
          title: "Transaction Created",
          description: "Your transaction has been created",
          duration: 5000,
        });
        void ctx.transaction.getPendingTransactions.invalidate();
        setRecipientAddress("");
      },
      onError: (e) => {
        console.error(e);
        setLoading(false);
      },
    });

  async function sendAll() {
    if (!connected) throw new Error("Wallet not connected");
    if (!appWallet) throw new Error("Wallet not found");
    if (!userAddress) throw new Error("User address not found");

    setLoading(true);

    try {
      const blockchainProvider = getProvider(network);
      const utxos = await blockchainProvider.fetchAddressUTxOs(
        appWallet.address,
      );

      const assets: { [key: string]: number } = utxos
        .map((utxo) => {
          return utxo.output.amount;
        })
        .reduce(
          (acc, assets) => {
            for (const asset of assets) {
              if (!(asset.unit in acc)) {
                acc[asset.unit] = 0;
              }
              acc[asset.unit]! += Number(asset.quantity);
            }
            return acc;
          },
          {} as { [key: string]: number },
        );
      console.log(assets);

      const txBuilder = getTxBuilder(network);

      for (const utxo of utxos) {
        txBuilder.txIn(
          utxo.input.txHash,
          utxo.input.outputIndex,
          utxo.output.amount,
          utxo.output.address,
        );
      }

      txBuilder.txOut(
        recipientAddress,
        Object.keys(assets).map((key) => {
          return {
            unit: key,
            quantity: assets[key]!.toString(),
          };
        }),
      );

      txBuilder.changeAddress(appWallet.address);
      txBuilder.selectUtxosFrom(utxos);

      const unsignedTx = await txBuilder.complete();
      console.log("unsignedTx", unsignedTx);
      
    } catch (e) {
      console.error(e);
    }

    setLoading(false);
  }

  return (
    <CardUI title="Send all assets" icon={Send}>
      <>
        <p>Send all assets from this wallet to another wallet.</p>

        <div className="grid gap-6">
          <div className="grid gap-3">
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              type="text"
              className="w-full"
              placeholder="addr1..."
              value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)}
            />
          </div>
          <div className="grid gap-3">
            <Button onClick={() => sendAll()} disabled={loading}>
              {loading ? (
                <Loader className="h-4 w-4 animate-spin" />
              ) : (
                "Send All"
              )}
            </Button>
          </div>
        </div>
      </>
    </CardUI>
  );
}
