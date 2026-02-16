import { api } from "@/utils/api";
import { useToast } from "./use-toast";
import { useCallback } from "react";
import { useSiteStore } from "@/lib/zustand/site";
import useAppWallet from "./useAppWallet";
import { MeshTxBuilder } from "@meshsdk/core";
import { csl } from "@meshsdk/core-csl";
import useActiveWallet from "./useActiveWallet";
import {
  mergeSignerWitnesses,
  shouldSubmitMultisigTx,
  submitTxWithScriptRecovery,
} from "@/utils/txSignUtils";
import { getProvider } from "@/utils/get-provider";
import { STAKE_KEY_DEPOSIT_LOVELACE } from "@/utils/staking-constants";

function getStakeKeyDepositDelta(txBuilder: MeshTxBuilder): bigint {
  const body = txBuilder.meshTxBuilderBody as {
    certificates?: Array<{ certType?: { type?: string } }>;
  };
  const certs = body.certificates ?? [];

  let delta = 0n;
  for (const cert of certs) {
    const certType = cert?.certType?.type ?? "";
    const normalized = certType.toLowerCase();
    const isDeregister =
      normalized.includes("deregister") || normalized.includes("unregister");
    const isRegister =
      !isDeregister &&
      (normalized.includes("registerstake") || normalized.includes("registration"));

    if (isRegister) {
      delta -= STAKE_KEY_DEPOSIT_LOVELACE;
      continue;
    }
    if (isDeregister) {
      delta += STAKE_KEY_DEPOSIT_LOVELACE;
    }
  }

  return delta;
}

function adjustTxForStakeKeyDeposit(
  unsignedTxHex: string,
  coinDelta: bigint,
  changeAddress?: string,
): string {
  if (coinDelta === 0n) {
    return unsignedTxHex;
  }

  const tx = csl.Transaction.from_hex(unsignedTxHex);
  const bodyJson = JSON.parse(tx.body().to_json()) as {
    outputs?: Array<{ address?: string; amount?: { coin?: string } }>;
  };
  const outputs = bodyJson.outputs ?? [];
  if (outputs.length === 0) {
    return unsignedTxHex;
  }

  let changeOutputIndex = -1;
  if (changeAddress) {
    for (let i = 0; i < outputs.length; i++) {
      const output = outputs[i];
      if (output?.address === changeAddress) {
        changeOutputIndex = i;
      }
    }
  }

  if (changeOutputIndex < 0) {
    changeOutputIndex = outputs.length - 1;
  }

  const changeOutput = outputs[changeOutputIndex];
  const currentCoin = BigInt(changeOutput?.amount?.coin ?? "0");
  if (!changeOutput?.amount?.coin) {
    return unsignedTxHex;
  }

  const adjustedCoin = currentCoin + coinDelta;
  if (adjustedCoin <= 0n) {
    return unsignedTxHex;
  }
  changeOutput.amount.coin = adjustedCoin.toString();

  const adjustedTxBody = csl.TransactionBody.from_json(JSON.stringify(bodyJson));
  const adjustedTx = csl.Transaction.new(
    adjustedTxBody,
    csl.TransactionWitnessSet.from_bytes(tx.witness_set().to_bytes()),
    tx.auxiliary_data(),
  );
  if (!tx.is_valid()) {
    adjustedTx.set_is_valid(false);
  }
  return adjustedTx.to_hex();
}

export default function useTransaction() {
  const ctx = api.useUtils();
  const { toast } = useToast();
  const { activeWallet, userAddress } = useActiveWallet();
  const setLoading = useSiteStore((state) => state.setLoading);
  const network = useSiteStore((state) => state.network);
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

      let unsignedTx = await data.txBuilder.complete();

      // Workaround for stake cert txs where builder-produced change may not
      // fully account for stake key deposit charge/refund in downstream validation.
      const stakeDepositDelta = getStakeKeyDepositDelta(data.txBuilder);
      if (stakeDepositDelta !== 0n) {
        unsignedTx = adjustTxForStakeKeyDeposit(
          unsignedTx,
          stakeDepositDelta,
          appWallet.address,
        );
      }

      if (!activeWallet) {
        throw new Error("No wallet available for signing transaction");
      }

      const signerWitnessPayload = await activeWallet.signTx(unsignedTx, true);
      let signedTx = mergeSignerWitnesses(
        unsignedTx,
        signerWitnessPayload,
      );
      

      const signedAddresses = [];
      signedAddresses.push(userAddress);

      let txHash = undefined;

      //Todo refactor to as util with Signable.

      const submitTx = shouldSubmitMultisigTx(appWallet, signedAddresses.length);

      if (submitTx) {
        const blockchainProvider = getProvider(network);
        const submitResult = await submitTxWithScriptRecovery({
          txHex: signedTx,
          submitter: blockchainProvider,
          appWallet,
          network,
        });
        txHash = submitResult.txHash;
        signedTx = submitResult.txHex;
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
    [appWallet, userAddress, activeWallet, createTransaction, setLoading, toast, network],
  );

  return { newTransaction };
}
