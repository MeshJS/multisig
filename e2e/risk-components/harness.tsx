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
import usePendingTransactionReview from "@/hooks/usePendingTransactionReview";
import {
  PendingRiskDialog,
  PendingRiskSummary,
} from "@/components/pages/wallet/transactions/pending-risk-review";

declare global {
  interface Window {
    riskFixture: DraftBuildResult;
    invalidateRiskReview: () => void;
    riskCalls: { sign: number; submit: number; export: number };
    pendingMode?: boolean;
    changePendingContext: (kind: string) => void;
  }
}
function PendingHarness() {
  const opener = useRef<Element | null>(null);
  const [identity, setIdentity] = useState("first-signer");
  const [signer, setSigner] = useState({});
  const [network, setNetwork] = useState(
    window.riskFixture.riskAssessment!.networkId,
  );
  const [hex, setHex] = useState(window.riskFixture.unsignedTx);
  const [busy, setBusy] = useState(false);
  const review = usePendingTransactionReview({
    txHex: hex,
    context: { network },
    identity,
    signer,
    enabled: true,
    provider: { fetchUTxOs: async () => [], fetchAddressUTxOs: async () => [] },
  });
  window.changePendingContext = (kind) => {
    if (kind === "account") setIdentity((value) => value + "-changed");
    if (kind === "wallet") setSigner({});
    if (kind === "network") setNetwork((value) => (value === 1 ? 0 : 1));
    if (kind === "replacement") {
      window.riskFixture.riskAssessment!.txHash = "ab".repeat(32);
      setHex("replacement");
    }
    if (kind === "witness") setHex((value) => value + "witness");
    if (kind === "fixture") setHex(window.riskFixture.unsignedTx);
  };
  async function sign() {
    opener.current = document.activeElement;
    setBusy(true);
    const captured = review.capture();
    if ((await captured.review()) && captured.isCurrent()) {
      window.riskCalls.sign++;
      window.riskCalls.submit++;
    }
    setBusy(false);
  }
  return (
    <main className="p-4">
      <PendingRiskSummary
        assessment={review.assessment}
        network={network}
        loading={review.loading}
        retry={review.retry}
      />
      <button disabled={busy} onClick={() => void sign()}>
        Approve pending transaction
      </button>
      {review.dialog && (
        <PendingRiskDialog
          returnFocus={opener.current}
          key={review.dialog.id}
          assessment={review.dialog.assessment}
          network={network}
          onDecision={review.decide}
        />
      )}
    </main>
  );
}

function Harness() {
  const opener = useRef<Element | null>(null);
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
  const [error, setError] = useState<string>();
  window.invalidateRiskReview = () => {
    revision.current++;
    finish.current?.({ accepted: false, acknowledged: false });
    setReview(undefined);
  };
  async function act(action: ReviewAction) {
    opener.current = document.activeElement;
    setBusy(true);
    setError(undefined);
    const started = revision.current;
    try {
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
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="p-4">
      {error && <p role="alert">{error}</p>}
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
          returnFocus={opener.current}
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
createRoot(document.getElementById("root")!).render(
  window.pendingMode ? <PendingHarness /> : <Harness />,
);
