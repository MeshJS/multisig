import { useEffect, useRef, useState } from "react";
import type { IWallet } from "@meshsdk/core";
import type { TxDraft } from "@/types/tx-draft";
import type { DraftIssue } from "@/lib/tx-draft/validate";
import {
  discoverCollateral,
  type CollateralCandidate,
} from "@/lib/tx-draft/collateral";
import { utxoRefKey } from "@/lib/tx-draft/resolve-script-inputs";
import { getProvider } from "@/utils/get-provider";

type Revision = {
  draft: TxDraft;
  wallet: IWallet | null;
  network: number;
  environment: string;
  attempt: number;
};
const matches = (a: Revision, b: Revision) =>
  a.draft === b.draft &&
  a.wallet === b.wallet &&
  a.network === b.network &&
  a.environment === b.environment &&
  a.attempt === b.attempt;

export function useDraftCollateral(
  draft: TxDraft,
  wallet: IWallet | null,
  network: number,
  environment: string,
) {
  const [attempt, setAttempt] = useState(0);
  const revision = useRef({ draft, wallet, network, environment, attempt });
  const current = { draft, wallet, network, environment, attempt };
  revision.current = current;
  const [result, setResult] = useState<{
    revision: typeof current;
    candidates: CollateralCandidate[];
    error?: string;
  }>();
  const enabled = draft.scriptInputs.length > 0;
  useEffect(() => {
    if (!enabled || !wallet) return;
    const snapshot = revision.current;
    let cancelled = false;
    const timer = setTimeout(() => {
      void Promise.resolve()
        .then(() => discoverCollateral(wallet, network, getProvider(network)))
        .then(
          (candidates) => {
            if (!cancelled && matches(snapshot, revision.current))
              setResult({ revision: snapshot, candidates });
          },
          (error: unknown) => {
            if (!cancelled && matches(snapshot, revision.current))
              setResult({
                revision: snapshot,
                candidates: [],
                error:
                  error instanceof Error
                    ? error.message
                    : "Could not discover collateral. Retry.",
              });
          },
        );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft, wallet, network, environment, attempt, enabled]);
  const settled =
    result && matches(result.revision, current) ? result : undefined;
  const candidates = enabled ? (settled?.candidates ?? []) : [];
  const selected = candidates.find(
    (c) =>
      draft.collateral &&
      utxoRefKey(c.utxo.input) === utxoRefKey(draft.collateral.utxoRef),
  );
  const loading = enabled && !!wallet && !settled;
  const message = !enabled
    ? undefined
    : !wallet
      ? "Connect a wallet to supply an existing ADA-only collateral UTxO."
      : loading
        ? "Checking wallet collateral on chain…"
        : (settled?.error ??
          (!candidates.length
            ? "No eligible existing collateral found. Connect a wallet with an unspent ADA-only payment-key UTxO and retry."
            : !selected
              ? "Select collateral from the connected wallet. A previous selection may be spent or belong to another account."
              : undefined));
  const issues: DraftIssue[] = message
    ? [
        {
          level: "error",
          code: "collateral-unavailable",
          field: "collateral",
          message,
        },
      ]
    : [];
  return {
    candidates,
    selected,
    loading,
    issues,
    retry: () => setAttempt((value) => value + 1),
  };
}
export type DraftCollateralState = ReturnType<typeof useDraftCollateral>;
