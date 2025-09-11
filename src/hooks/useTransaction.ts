import { api } from "@/utils/api";
import { useToast } from "./use-toast";
import { useCallback } from "react";
import { useSiteStore } from "@/lib/zustand/site";
import { useWallet } from "@meshsdk/react";
import { useUserStore } from "@/lib/zustand/user";
import useAppWallet from "./useAppWallet";
import { MeshTxBuilder } from "@meshsdk/core";
import { getProvider } from "@/utils/get-provider";

export default function useTransaction() {
  const ctx = api.useUtils();
  const { toast } = useToast();
  const { wallet } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const setLoading = useSiteStore((state) => state.setLoading);
  const { appWallet } = useAppWallet();
  const network = useSiteStore((state) => state.network);
  const blockchainProvider = getProvider(network);

  const { mutateAsync: createTransaction } =
    api.transaction.createTransaction.useMutation({
      onSuccess: async () => {
        void ctx.transaction.getPendingTransactions.invalidate();
        void ctx.transaction.getAllTransactions.invalidate();
      },
      onError: (e) => {
        console.error("createTransaction", e);
      },
    });

  const newTransaction = useCallback(
    async (data: {
      txBuilder: MeshTxBuilder;
      description?: string;
      toastMessage?: string;
      metadataValue?: {
        label: string;
        value: string;
      };
    }) => {
      if (!appWallet) throw new Error("No wallet");
      if (!userAddress) throw new Error("No user address");

      if (data.metadataValue) {
        let value: string | string[] = data.metadataValue.value;

        if (value.length > 63) {
          value = value.match(/.{1,63}/g)!;
        }
        data.txBuilder.metadataValue(data.metadataValue.label, {
          msg: value,
        });
      }

      const unsignedTx = await data.txBuilder.complete();

      console.log("unsignedTX:",unsignedTx)

      const signedTx = await wallet.signTx(unsignedTx, true);

      console.log("signedTX:",signedTx)
      

      const signedAddresses = [];
      signedAddresses.push(userAddress);

      let txHash = undefined;

      //Todo refactor to as util with Signable.

      let submitTx = false;

      if (appWallet.type == "any") {
        submitTx = true;
      } else if (
        appWallet.type == "atLeast" &&
        appWallet.numRequiredSigners == signedAddresses.length
      ) {
        submitTx = true;
      } else if (
        appWallet.type == "all" &&
        appWallet.signersAddresses.length == signedAddresses.length
      ) {
        submitTx = true;
      }

      if (submitTx) {
        //txHash = await blockchainProvider.submitTx(signedTx);
        txHash = await wallet.submitTx(signedTx);
      }

      await createTransaction({
        walletId: appWallet.id,
        txJson: JSON.stringify(data.txBuilder.meshTxBuilderBody),
        txCbor: signedTx,
        signedAddresses: signedAddresses,
        state: submitTx ? 1 : 0,
        description: data.description,
        txHash: txHash,
      });

      setLoading(false);

      toast({
        title: "Transaction Created",
        description: data.toastMessage ?? "Your transaction has been created",
        duration: 10000,
      });
    },
    [appWallet, userAddress, wallet, createTransaction],
  );

  return { newTransaction };
}
