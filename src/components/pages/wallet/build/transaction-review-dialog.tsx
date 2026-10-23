import { useRef, useState } from "react";
import type { DraftBuildResult } from "@/lib/tx-draft/build-draft-tx";
import {
  reviewIsComplete,
  reviewNeedsAcknowledgment,
  type ReviewAction,
  type ReviewDecision,
} from "@/lib/tx-risk/review-policy";
import { baseToDisplay } from "@/lib/tx-draft/decimal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import OutputReviewList from "./output-review-list";
import PlutusReview from "./plutus-review";
import RequiredSigners from "./required-signers";
import RiskSummary from "./risk-summary";

/** Mount a new instance for each review request. No acceptance survives closing. */
export default function TransactionReviewDialog({
  result,
  network,
  action,
  onDecision,
  returnFocus,
}: {
  result: DraftBuildResult;
  network: number;
  action: ReviewAction;
  onDecision: (decision: ReviewDecision) => void;
  returnFocus?: Element | null;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  // This async dialog has no Radix DialogTrigger to restore focus to.
  const opener = useRef(
    returnFocus ??
      (typeof document === "undefined" ? null : document.activeElement),
  );
  const risk = result.riskAssessment;
  const needsAcknowledgment = reviewNeedsAcknowledgment(result);
  const complete = reviewIsComplete(result, network);
  const cancel = () => onDecision({ accepted: false, acknowledged: false });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
        data-testid="tx-builder-risk-review"
        onCloseAutoFocus={(event) => {
          if (
            opener.current instanceof HTMLElement &&
            opener.current.isConnected
          ) {
            event.preventDefault();
            opener.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Review transaction</DialogTitle>
          <DialogDescription>
            Check who can spend these outputs, the final amounts and any
            collateral before {action === "export" ? "exporting" : "signing"}.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm font-medium">
          {network === 1 ? "Mainnet" : "Testnet"}
        </p>
        <RiskSummary findings={risk?.findings ?? []} network={network} />
        {!complete && (
          <div role="alert" className="text-sm text-destructive">
            <p>
              Unable to verify this transaction. Cancel and rebuild to retry
              before {action === "export" ? "exporting" : "signing"}.
            </p>
            {risk?.errors.map((error, i) => (
              <p key={i}>{error.message}</p>
            ))}
          </div>
        )}
        <OutputReviewList outputs={result.outputReview ?? []} />
        <RequiredSigners keys={result.body.requiredSignatures} unsigned />
        {result.plutusReview && <PlutusReview review={result.plutusReview} />}
        <p className="text-sm">
          Network fee: {baseToDisplay(result.fee, 6)} ADA
        </p>
        {needsAcknowledgment && (
          <label className="flex items-start gap-3 rounded border border-destructive p-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span>
              I understand anyone can spend the funds sent to the outputs marked
              “Anyone can spend”.
            </span>
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={cancel}>
            Cancel and edit
          </Button>
          <Button
            data-testid="tx-builder-review-continue"
            disabled={!complete || (needsAcknowledgment && !acknowledged)}
            onClick={() => {
              if (complete && (!needsAcknowledgment || acknowledged))
                onDecision({ accepted: true, acknowledged });
            }}
          >
            {action === "export" ? "Continue to export" : "Continue to signing"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
