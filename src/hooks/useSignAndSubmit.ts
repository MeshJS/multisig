import { useCallback } from "react";

import useActiveWallet from "./useActiveWallet";
import { mergeSignerWitnesses } from "@/utils/txSignUtils";
import { transactionReadiness } from "@/utils/transactionReadiness";
import { getProvider } from "@/utils/get-provider";
import { useSiteStore } from "@/lib/zustand/site";

/**
 * Signs and submits a transaction funded by the connected wallet itself
 * (full signature — not the partial multisig witness flow in
 * `useTransaction`). Mirrors the deposit page; nothing is persisted.
 */
export default function useSignAndSubmit() {
  const { activeWallet } = useActiveWallet();
  const network = useSiteStore((s) => s.network);

  const signAndSubmit = useCallback(
    async (
      unsignedTx: string,
    ): Promise<{ txHash: string; signedTx: string }> => {
      if (!activeWallet) {
        throw new Error("No wallet available for signing transaction");
      }
      const payload = await activeWallet.signTx(unsignedTx);
      const merged = mergeSignerWitnesses(unsignedTx, payload);
      if (merged.invalidVkeyPubKeysHex.length)
        throw new Error("Wallet returned an invalid transaction signature.");
      const signedTx = merged.txHex;
      const readiness = await transactionReadiness(
        signedTx,
        true,
        getProvider(network),
        network,
      );
      if (!readiness.ready)
        throw new Error(
          `Missing required payment-key signature: ${readiness.missingKeyHashes.join(", ")}. Ask the collateral owner to sign.`,
        );
      const txHash = await activeWallet.submitTx(signedTx);
      return { txHash, signedTx };
    },
    [activeWallet, network],
  );

  return { signAndSubmit, canSign: activeWallet !== null };
}
