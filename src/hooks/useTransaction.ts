import { api } from "@/utils/api";
import { useToast } from "./use-toast";
import { useCallback } from "react";
import { useSiteStore } from "@/lib/zustand/site";
import { useUserStore } from "@/lib/zustand/user";
import useAppWallet from "./useAppWallet";
import { MeshTxBuilder } from "@meshsdk/core";
import useActiveWallet from "./useActiveWallet";

export default function useTransaction() {
  const ctx = api.useUtils();
  const { toast } = useToast();
  const { activeWallet, userAddress } = useActiveWallet();
  const setLoading = useSiteStore((state) => state.setLoading);
  const { appWallet } = useAppWallet();

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

      if (!activeWallet) {
        throw new Error("No wallet available for signing transaction");
      }

      const signedTx = await activeWallet.signTx(unsignedTx, true);
      

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
        txHash = await activeWallet.submitTx(signedTx);
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
    [appWallet, userAddress, activeWallet, createTransaction, setLoading, toast],
  );

  return { newTransaction };
}
