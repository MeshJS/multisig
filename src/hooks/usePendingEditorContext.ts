import { useMemo } from "react";
import useAppWallet from "@/hooks/useAppWallet";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import { useSiteStore } from "@/lib/zustand/site";
import { deriveDrepVoteContext } from "@/lib/governance/drep-context";
import { deriveStakeCertContext } from "@/lib/staking/stake-context";
import { resolveExpectedPaymentScriptCbor } from "@/utils/txSignUtils";
import type { PendingEditorContext } from "@/lib/tx-draft/reconstruct-pending";

export default function usePendingEditorContext(): PendingEditorContext {
  const { appWallet } = useAppWallet();
  const { multisigWallet } = useMultisigWallet();
  const network = useSiteStore((state) => state.network);
  return useMemo(() => {
    if (!appWallet) return { network };
    let cbor = appWallet.scriptCbor ?? "";
    try {
      cbor = resolveExpectedPaymentScriptCbor(appWallet, network) ?? cbor;
    } catch {
      /* Resolver reports identity failure. */
    }
    return {
      network,
      walletNativeScript: { address: appWallet.address, cbor },
      stake: deriveStakeCertContext(multisigWallet, appWallet),
      drep: deriveDrepVoteContext(multisigWallet, appWallet),
    };
  }, [appWallet, multisigWallet, network]);
}
