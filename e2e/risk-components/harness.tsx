import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DraftBuildResult } from "@/lib/tx-draft/build-draft-tx";
import {
  reviewBuiltTransaction,
  type ReviewAction,
  type ReviewDecision,
} from "@/lib/tx-risk/review";
import TransactionReviewDialog from "@/components/pages/wallet/build/transaction-review-dialog";
import BuildResultPanel from "@/components/pages/wallet/build/build-result-panel";

declare global {
  interface Window {
    riskFixture: DraftBuildResult;
    invalidateRiskReview: () => void;
    riskCalls: { sign: number; submit: number; export: number };
  }
}

function Harness() {
  const result = window.riskFixture;
  const revision = useRef(0);
  const finish = useRef<((d: ReviewDecision) => void) | undefined>(undefined);
  const [review, setReview] = useState<{
    result: DraftBuildResult;
    action: ReviewAction;
    id: number;
  }>();
  const request = useRef(0);
  const [busy, setBusy] = useState(false);
  window.invalidateRiskReview = () => {
    revision.current++;
    finish.current?.({ accepted: false, acknowledged: false });
    setReview(undefined);
  };
  async function act(action: ReviewAction) {
    setBusy(true);
    const started = revision.current;
    const accepted = await reviewBuiltTransaction(result, {
      network: result.riskAssessment!.networkId,
      isCurrent: () => started === revision.current,
      refresh: async () => structuredClone(result.riskAssessment!),
      confirm: (reviewed) =>
        new Promise((resolve) => {
          finish.current = resolve;
          setReview({ result: reviewed, action, id: ++request.current });
        }),
    });
    if (accepted) {
      if (action === "export") window.riskCalls.export++;
      else {
        window.riskCalls.sign++;
        window.riskCalls.submit++;
      }
    }
    setBusy(false);
  }
  return (
    <main className="p-4">
      <button disabled={busy} onClick={() => void act("sign")}>
        Build and sign fixture
      </button>
      <BuildResultPanel
        result={{
          status: "ok",
          result,
          revision: revision.current,
          description: "Fixture",
        }}
        hasPendingRationaleEdits={false}
        busy={busy}
        onDismiss={() => {}}
        onCopy={() => act("export")}
      />
      {review && (
        <TransactionReviewDialog
          key={review.id}
          result={review.result}
          action={review.action}
          network={result.riskAssessment!.networkId}
          onDecision={(d) => {
            finish.current?.(d);
            setReview(undefined);
          }}
        />
      )}
    </main>
  );
}
window.riskCalls = { sign: 0, submit: 0, export: 0 };
createRoot(document.getElementById("root")!).render(<Harness />);
