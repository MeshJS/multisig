import { useEffect, useRef, useState } from "react";
import {
  resolvePendingTransaction,
  type PendingEditorContext,
  type PendingEditorResult,
  type PendingEditorRow,
} from "@/lib/tx-draft/reconstruct-pending";
import type { ScriptInputProvider } from "@/lib/tx-draft/resolve-script-inputs";

/** Compatibility is tied to bytes, advisory provenance and authoritative wallet
 * context. Replacement/network changes immediately hide any previous success. */
export default function usePendingEditor(
  row: PendingEditorRow,
  context: PendingEditorContext,
  provider: ScriptInputProvider,
  enabled = true,
) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([row, context, enabled, attempt]);
  const current = useRef(key);
  current.current = key;
  const [resolved, setResolved] = useState<{
    key: string;
    result: PendingEditorResult;
  }>();
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void resolvePendingTransaction(row, context, provider).then((result) => {
      if (!cancelled && current.current === key) setResolved({ key, result });
    });
    return () => {
      cancelled = true;
    };
  }, [key, provider]);
  const result = resolved?.key === key ? resolved.result : undefined;
  return {
    result,
    loading: enabled && !result,
    retry: () => setAttempt((value) => value + 1),
  };
}
