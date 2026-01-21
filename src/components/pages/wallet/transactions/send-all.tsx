import { Loader, Send } from "lucide-react";
import { Wallet } from "@/types/wallet";
import CardUI from "@/components/ui/card-content";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useWallet } from "@meshsdk/react";
import useActiveWallet from "@/hooks/useActiveWallet";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
// import { api } from "@/utils/api";
// import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "@/lib/zustand/user";
import { useSiteStore } from "@/lib/zustand/site";
import { getProvider } from "@/utils/get-provider";
import { getTxBuilder } from "@/utils/get-tx-builder";
import useTransaction from "@/hooks/useTransaction";

export default function CardSendAll({ appWallet }: { appWallet: Wallet }) {
  const { wallet, connected } = useWallet();
  const { isWalletReady } = useActiveWallet();
  // const [loading, setLoading] = useState<boolean>(false);
  const [recipientAddress, setRecipientAddress] = useState<string>("");
  // const ctx = api.useUtils();
  // const { toast } = useToast();
  const userAddress = useUserStore((state) => state.userAddress);
  const network = useSiteStore((state) => state.network);
  const { newTransaction } = useTransaction();
  const loading = useSiteStore((state) => state.loading);
  const setLoading = useSiteStore((state) => state.setLoading);

  // const { mutate: createTransaction } =
  //   api.transaction.createTransaction.useMutation({
  //     onSuccess: async () => {
  //       setLoading(false);
  //       toast({
  //         title: "Transaction Created",
  //         description: "Your transaction has been created",
  //         duration: 5000,
  //       });
  //       void ctx.transaction.getPendingTransactions.invalidate();
  //       setRecipientAddress("");
  //     },
  //     onError: (e) => {
  //       console.error(e);
  //       setLoading(false);
  //     },
  //   });

  async function sendAll() {
    if (!isWalletReady) throw new Error("Wallet not connected");
    if (!appWallet) throw new Error("Wallet not found");
    if (!userAddress) throw new Error("User address not found");

    setLoading(true);

    try {
      const blockchainProvider = getProvider(network);
      const utxos = await blockchainProvider.fetchAddressUTxOs(
        appWallet.address,
      );

      const txBuilder = getTxBuilder(network);

      for (const utxo of utxos) {
        txBuilder.txIn(
          utxo.input.txHash,
          utxo.input.outputIndex,
          utxo.output.amount,
          utxo.output.address,
        );
        txBuilder.txInScript(appWallet.scriptCbor);
      }

      txBuilder.changeAddress(recipientAddress);

      // const unsignedTx = await txBuilder.complete();

      // const signedTx = await wallet.signTx(unsignedTx, true);

      // const signedAddresses = [];
      // signedAddresses.push(userAddress);

      // let txHash = undefined;
      // let state = 0;
      // if (appWallet.numRequiredSigners == signedAddresses.length) {
      //   state = 1;
      //   txHash = await wallet.submitTx(signedTx);
      // }

      // createTransaction({
      //   walletId: appWallet.id,
      //   txJson: JSON.stringify(txBuilder.meshTxBuilderBody),
      //   txCbor: signedTx,
      //   signedAddresses: [userAddress],
      //   state: state,
      //   description: `Send all assets`,
      //   txHash: txHash,
      // });

      await newTransaction({
        txBuilder,
        description: "Send all assets",
      });
      setRecipientAddress("");
    } catch (e) {
      console.error(e);
    }

    setLoading(false);
  }

  if (!appWallet) return null;

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
