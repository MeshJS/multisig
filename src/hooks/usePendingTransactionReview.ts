import { useEffect, useMemo, useRef, useState } from "react";
import {
  assessTransactionRisks,
  resolveTransactionRisks,
} from "@/lib/tx-risk/transaction";
import { reviewPendingTransaction } from "@/lib/tx-risk/pending-review";
import type { RiskAssessment, RiskContext } from "@/lib/tx-risk/types";
import type { ReviewDecision } from "@/lib/tx-risk/review-policy";
import type { ScriptInputProvider } from "@/lib/tx-draft/resolve-script-inputs";

export default function usePendingTransactionReview(options: {
  txHex: string;
  context: RiskContext;
  /** Row, wallet/source and account identity; never description or txJson. */
  identity: string;
  signer: unknown;
  enabled: boolean;
  provider: ScriptInputProvider;
}) {
  const { txHex, context, identity, signer, enabled, provider } = options;
  const contextKey = JSON.stringify(context);
  const initial = useMemo(
    () => assessTransactionRisks(txHex, context),
    [txHex, contextKey],
  );
  // Witness additions alone do not change the transaction being approved.
  const key = JSON.stringify([
    initial.txHash ?? txHex,
    contextKey,
    identity,
    enabled,
  ]);
  const current = useRef({ key, signer, generation: 0 });
  if (current.current.key !== key || current.current.signer !== signer)
    current.current = {
      key,
      signer,
      generation: current.current.generation + 1,
    };
  const generation = current.current.generation;
  const mounted = useRef(true);
  const [resolved, setResolved] = useState<{
    generation: number;
    assessment: RiskAssessment;
  }>();
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<{
    generation: number;
    id: number;
    assessment: RiskAssessment;
  }>();
  const request = useRef(0);
  const refreshId = useRef(0);
  const finish = useRef<((decision: ReviewDecision) => void) | undefined>(
    undefined,
  );
  function decide(decision: ReviewDecision) {
    const resolve = finish.current;
    finish.current = undefined;
    setDialog(undefined);
    resolve?.(decision);
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      finish.current?.({ accepted: false, acknowledged: false });
    };
  }, []);
  useEffect(() => {
    decide({ accepted: false, acknowledged: false });
  }, [generation]);

  function capture() {
    const isCurrent = () =>
      mounted.current && enabled && current.current.generation === generation;
    const refresh = async () => {
      const id = ++refreshId.current;
      const assessment = await resolve(isCurrent);
      if (isCurrent() && id === refreshId.current) {
        setResolved({ generation, assessment });
        setLoading(false);
      }
      return assessment;
    };
    return {
      isCurrent,
      review: () =>
        reviewPendingTransaction(txHex, {
          network: context.network,
          isCurrent,
          refresh,
          confirm: (assessment) =>
            new Promise<ReviewDecision>((resolve) => {
              finish.current?.({ accepted: false, acknowledged: false });
              finish.current = resolve;
              setDialog({ generation, id: ++request.current, assessment });
            }),
        }),
    };
  }
  async function resolve(isCurrent: () => boolean) {
    try {
      return await resolveTransactionRisks(txHex, context, provider, isCurrent);
    } catch {
      return {
        ...initial,
        status: "incomplete" as const,
        errors: [
          ...initial.errors,
          {
            code: "input-unresolved" as const,
            message: "Unable to load transaction facts. Retry before signing.",
          },
        ],
      };
    }
  }
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const id = ++refreshId.current;
    setLoading(true);
    void resolve(
      () => !cancelled && current.current.generation === generation,
    ).then((assessment) => {
      if (
        !cancelled &&
        current.current.generation === generation &&
        id === refreshId.current
      ) {
        setResolved({ generation, assessment });
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [generation, attempt]);
  return {
    assessment:
      resolved?.generation === generation ? resolved.assessment : initial,
    loading: loading || resolved?.generation !== generation,
    retry: () => setAttempt((value) => value + 1),
    dialog: dialog?.generation === generation ? dialog : undefined,
    decide,
    capture,
  };
}
