import { useEffect, useRef, useState } from "react";
import type { TxDraft } from "@/types/tx-draft";
import type { DraftIssue } from "@/lib/tx-draft/validate";
import {
  resolveDraftScriptInputs,
  type ScriptInputResolution,
} from "@/lib/tx-draft/resolve-script-inputs";
import { getProvider } from "@/utils/get-provider";

export type DraftScriptInputsState = {
  resolutions: ScriptInputResolution[];
  issues: DraftIssue[];
  loading: boolean;
  retry: () => void;
};

/** Results belong to the exact draft/environment, never a prior successful edit. */
export function useDraftScriptInputs(
  draft: TxDraft,
  network: number,
  environment: string,
): DraftScriptInputsState {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{
    draft: TxDraft;
    network: number;
    environment: string;
    attempt: number;
    resolutions: ScriptInputResolution[];
  }>();
  const current = useRef({ draft, network, environment, attempt });
  current.current = { draft, network, environment, attempt };
  const hasInputs = (draft.scriptInputs ?? []).length > 0;
  useEffect(() => {
    if (!hasInputs) return;
    let cancelled = false;
    const isCurrent = () =>
      !cancelled &&
      current.current.draft === draft &&
      current.current.network === network &&
      current.current.environment === environment &&
      current.current.attempt === attempt;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const resolutions = await resolveDraftScriptInputs(
            draft,
            network,
            getProvider(network),
            isCurrent,
          );
          if (isCurrent())
            setSettled({ draft, network, environment, attempt, resolutions });
        } catch {
          if (isCurrent())
            setSettled({
              draft,
              network,
              environment,
              attempt,
              resolutions: draft.scriptInputs.map((input) => ({
                inputId: input.id,
                issues: [
                  {
                    level: "error",
                    code: "script-input-unavailable",
                    inputId: input.id,
                    inputRef: input.utxoRef,
                    field: "utxoRef",
                    message:
                      "Could not resolve script inputs. Check the provider and retry.",
                  },
                ],
              })),
            });
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft, network, environment, attempt, hasInputs]);
  const matches =
    settled?.draft === draft &&
    settled.network === network &&
    settled.environment === environment &&
    settled.attempt === attempt;
  const resolutions = hasInputs && matches ? settled.resolutions : [];
  const loading = hasInputs && !matches;
  return {
    resolutions,
    loading,
    issues: loading
      ? draft.scriptInputs.map((input) => ({
          level: "error",
          code: "script-input-unresolved",
          inputId: input.id,
          inputRef: input.utxoRef,
          field: "utxoRef",
          message: "Resolving script input on the current network…",
        }))
      : resolutions.flatMap((result) => result.issues),
    retry: () => setAttempt((value) => value + 1),
  };
}
