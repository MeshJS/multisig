import { useRef, useState } from "react";
import type { RiskAssessment } from "@/lib/tx-risk/types";
import type { ReviewDecision } from "@/lib/tx-risk/review-policy";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import RiskSummary from "../build/risk-summary";
import { baseToDisplay } from "@/lib/tx-draft/decimal";

export function PendingRiskSummary({
  assessment,
  network,
  loading,
  retry,
}: {
  assessment: RiskAssessment;
  network: number;
  loading: boolean;
  retry: () => void;
}) {
  return (
    <div className="m-4 space-y-2 text-sm" data-testid="pending-risk-review">
      <p className="font-medium">Transaction script review</p>
      <RiskSummary findings={assessment.findings} network={network} />
      {loading ? (
        <p role="status">Verifying transaction inputs and collateral…</p>
      ) : assessment.status === "incomplete" ? (
        <div role="alert">
          <p>Unable to verify this transaction. Retry before signing.</p>
          {assessment.errors.map((error, index) => (
            <p key={index}>{error.message}</p>
          ))}
          <Button variant="outline" onClick={retry}>
            Retry review
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Outputs and live input facts reviewed. This does not verify contract
          safety or the intended outcome.
        </p>
      )}
    </div>
  );
}

/** A fresh mount per signing attempt; no acknowledgment is stored on the proposal. */
export function PendingRiskDialog({
  assessment,
  network,
  onDecision,
  returnFocus,
}: {
  assessment: RiskAssessment;
  network: number;
  onDecision: (decision: ReviewDecision) => void;
  returnFocus?: Element | null;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  // This async dialog has no Radix DialogTrigger to restore focus to.
  const opener = useRef(
    returnFocus ??
      (typeof document === "undefined" ? null : document.activeElement),
  );
  const needsAcknowledgment = assessment.findings.some(
    (finding) => finding.requiresAcknowledgment,
  );
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
        data-testid="pending-risk-dialog"
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
          <DialogTitle>Review transaction before signing</DialogTitle>
          <DialogDescription>
            Review who can spend these funds and any collateral exposure. Each
            signer must make their own decision.
          </DialogDescription>
        </DialogHeader>
        <p>{network === 1 ? "Mainnet" : "Testnet"}</p>
        <RiskSummary findings={assessment.findings} network={network} />
        {assessment.collateral && (
          <div className="space-y-1 break-all text-xs">
            {assessment.collateral.owners.map((owner) => (
              <p key={`${owner.inputRef.txHash}#${owner.inputRef.outputIndex}`}>
                Collateral owner: {owner.address} (payment key{" "}
                {owner.paymentKeyHash}); selected{" "}
                {baseToDisplay(owner.lovelace, 6)} ADA.
              </p>
            ))}
            <p>
              Selected collateral:{" "}
              {baseToDisplay(assessment.collateral.selectedLovelace, 6)} ADA.
            </p>
            <p>
              Recorded return:{" "}
              {baseToDisplay(assessment.collateral.returnedLovelace, 6)} ADA
              {assessment.collateral.returnAddress &&
                ` to ${assessment.collateral.returnAddress}`}
              .
            </p>
            <p>
              Maximum exposure:{" "}
              {baseToDisplay(assessment.collateral.maximumExposureLovelace, 6)}{" "}
              ADA.
            </p>
          </div>
        )}
        {needsAcknowledgment && (
          <label className="flex items-start gap-3 rounded border border-destructive p-3 text-sm">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              I understand anyone can spend the funds sent to the outputs marked
              “Anyone can spend”.
            </span>
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={cancel}>
            Cancel
          </Button>
          <Button
            disabled={needsAcknowledgment && !acknowledged}
            onClick={() => {
              if (!needsAcknowledgment || acknowledged)
                onDecision({ accepted: true, acknowledged });
            }}
          >
            Continue to signing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
