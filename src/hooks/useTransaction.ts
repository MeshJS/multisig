import { api } from "@/utils/api";
import { useToast } from "./use-toast";
import { useCallback } from "react";
import { useSiteStore } from "@/lib/zustand/site";
import { useWallet } from "@meshsdk/react";
import { useUserStore } from "@/lib/zustand/user";
import useAppWallet from "./useAppWallet";
import { MeshTxBuilder } from "@meshsdk/core";

export default function useTransaction() {
  const ctx = api.useUtils();
  const { toast } = useToast();
  const { wallet } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const setLoading = useSiteStore((state) => state.setLoading);
  const { appWallet } = useAppWallet();

  const { mutateAsync: createTransaction } =
    api.transaction.createTransaction.useMutation({
      onError: (e) => {
        console.error("createTransaction", e);
      },
    });

  const newTransaction = useCallback(
    async (data: {
      txBuilder: MeshTxBuilder;
      description?: string;
      toastMessage?: string;
    }) => {
      if (!appWallet) throw new Error("No wallet");
      if (!userAddress) throw new Error("No user address");

      const unsignedTx = await data.txBuilder.complete();

      const signedTx = await wallet.signTx(unsignedTx, true);

      const signedAddresses = [];
      signedAddresses.push(userAddress);

      let txHash = undefined;
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
        txHash = await wallet.submitTx(signedTx);
      }

      await createTransaction({
        walletId: appWallet.id,
        txJson: JSON.stringify(data.txBuilder.meshTxBuilderBody),
        txCbor: signedTx,
        signedAddresses: [userAddress],
        state: submitTx ? 1 : 0,
        description: data.description,
        txHash: txHash,
      });

      void ctx.transaction.getPendingTransactions.invalidate();
      void ctx.transaction.getAllTransactions.invalidate();
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
