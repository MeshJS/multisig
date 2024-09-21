import { Button } from "@/components/ui/button";
import { Wallet } from "@/types/wallet";
import { useState } from "react";
import { api } from "@/utils/api";
import { useToast } from "@/hooks/use-toast";
import { useSiteStore } from "@/lib/zustand/site";
import { getProvider, getTxBuilder } from "@/components/common/cardano-objects";
import { keepRelevant, Quantity, Unit } from "@meshsdk/core";
import { useWallet } from "@meshsdk/react";
import { useUserStore } from "@/lib/zustand/user";

export default function Retire({ appWallet }: { appWallet: Wallet }) {
  const [loading, setLoading] = useState<boolean>(false);
  const { toast } = useToast();
  const ctx = api.useUtils();
  const network = useSiteStore((state) => state.network);
  const { wallet, connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);

  const { mutate: createTransaction } =
    api.transaction.createTransaction.useMutation({
      onSuccess: async () => {
        setLoading(false);
        toast({
          title: "Transaction Created",
          description: "DRep registration transaction has been created",
          duration: 5000,
        });
        void ctx.transaction.getPendingTransactions.invalidate();
      },
      onError: (e) => {
        console.error(e);
        setLoading(false);
      },
    });

  async function retireDrep() {
    if (!connected) throw new Error("Not connected to wallet");
    if (!userAddress) throw new Error("No user address");

    const blockchainProvider = getProvider(network);
    const utxos = await blockchainProvider.fetchAddressUTxOs(appWallet.address);

    const assetMap = new Map<Unit, Quantity>();
    assetMap.set("lovelace", "5000000");
    const selectedUtxos = keepRelevant(assetMap, utxos);
    if (selectedUtxos.length === 0) throw new Error("No relevant UTxOs found");

    const txBuilder = getTxBuilder(network);

    for (const utxo of selectedUtxos) {
      txBuilder.txIn(
        utxo.input.txHash,
        utxo.input.outputIndex,
        utxo.output.amount,
        utxo.output.address,
      );
    }

    txBuilder
      .txInScript(appWallet.scriptCbor)
      .changeAddress(appWallet.address)
      .drepDeregistrationCertificate(appWallet.dRepId, "500000000")
      .certificateScript(appWallet.scriptCbor);

    const unsignedTx = await txBuilder.complete();

    const signedTx = await wallet.signTx(unsignedTx, true);

    const signedAddresses = [];
    signedAddresses.push(userAddress);

    let txHash = undefined;
    let state = 0;
    if (appWallet.numRequiredSigners == signedAddresses.length) {
      state = 1;
      txHash = await wallet.submitTx(signedTx);
    }

    createTransaction({
      walletId: appWallet.id,
      txJson: JSON.stringify(txBuilder.meshTxBuilderBody),
      txCbor: signedTx,
      signedAddresses: [userAddress],
      state: state,
      description: "DRep retirement",
      txHash: txHash,
    });
  }

  return (
    <div>
      <Button onClick={() => retireDrep()} disabled={loading}>
        {loading ? "Loading..." : "Retire DRep"}
      </Button>
    </div>
  );
}
