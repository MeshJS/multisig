import { useCallback } from "react";

import useActiveWallet from "./useActiveWallet";

/**
 * Signs and submits a transaction funded by the connected wallet itself
 * (full signature — not the partial multisig witness flow in
 * `useTransaction`). Mirrors the deposit page; nothing is persisted.
 */
export default function useSignAndSubmit() {
  const { activeWallet } = useActiveWallet();

  const signAndSubmit = useCallback(
    async (unsignedTx: string): Promise<{ txHash: string; signedTx: string }> => {
      if (!activeWallet) {
        throw new Error("No wallet available for signing transaction");
      }
      const signedTx = await activeWallet.signTx(unsignedTx);
      const txHash = await activeWallet.submitTx(signedTx);
      return { txHash, signedTx };
    },
    [activeWallet],
  );

  return { signAndSubmit, canSign: activeWallet !== null };
}
