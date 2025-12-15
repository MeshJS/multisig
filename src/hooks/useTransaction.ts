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
      onMutate: async (newTransaction) => {
        // Cancel any outgoing refetches
        await ctx.transaction.getPendingTransactions.cancel({ walletId: newTransaction.walletId });
        await ctx.transaction.getAllTransactions.cancel({ walletId: newTransaction.walletId });

        // Snapshot the previous value
        const previousPending = ctx.transaction.getPendingTransactions.getData({ walletId: newTransaction.walletId });
        const previousAll = ctx.transaction.getAllTransactions.getData({ walletId: newTransaction.walletId });

        // Optimistically update pending transactions
        ctx.transaction.getPendingTransactions.setData(
          { walletId: newTransaction.walletId },
          (old) => {
            if (!old) return old;
            const optimisticTx = {
              id: `temp-${Date.now()}`,
              walletId: newTransaction.walletId,
              txJson: newTransaction.txJson,
              signedAddresses: newTransaction.signedAddresses,
              txCbor: newTransaction.txCbor,
              state: newTransaction.state,
              description: newTransaction.description ?? null,
              txHash: newTransaction.txHash ?? null,
              rejectedAddresses: [] as string[],
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            return [optimisticTx, ...old];
          }
        );

        return { previousPending, previousAll };
      },
      onError: (err, newTransaction, context) => {
        // Rollback on error
        if (context?.previousPending) {
          ctx.transaction.getPendingTransactions.setData(
            { walletId: newTransaction.walletId },
            context.previousPending
          );
        }
        if (context?.previousAll) {
          ctx.transaction.getAllTransactions.setData(
            { walletId: newTransaction.walletId },
            context.previousAll
          );
        }
        console.error("createTransaction", err);
      },
      onSuccess: async (data, variables) => {
        // Invalidate to refetch with real data
        void ctx.transaction.getPendingTransactions.invalidate({ walletId: variables.walletId });
        void ctx.transaction.getAllTransactions.invalidate({ walletId: variables.walletId });
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
