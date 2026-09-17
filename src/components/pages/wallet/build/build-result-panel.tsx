import { AlertTriangle, CheckCircle2, Copy, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { DraftBuildResult } from "@/lib/tx-draft/build-draft-tx";
import { getFirstAndLast, lovelaceToAda } from "@/utils/strings";

export type BuildResultState =
  | { status: "ok"; result: DraftBuildResult; description: string }
  | { status: "error"; message: string };

interface BuildResultPanelProps {
  result: BuildResultState;
  /** Votes with unsaved rationale edits build with their old anchor. */
  hasPendingRationaleEdits: boolean;
  onDismiss: () => void;
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}

/**
 * Outcome of a test build. On success the canvas itself overlays the fee,
 * selected inputs and change; this strip carries what the canvas can't show
 * (size, hash, CBOR). On failure it shows why the build failed. Rendered
 * under the builder header; the page clears it whenever the draft changes.
 */
export default function BuildResultPanel({
  result,
  hasPendingRationaleEdits,
  onDismiss,
}: BuildResultPanelProps) {
  const { toast } = useToast();

  if (result.status === "error") {
    return (
      <div
        data-testid="tx-builder-build-result"
        data-status="error"
        className="flex items-start justify-between gap-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">Transaction failed to build</span>
            <span
              className="text-muted-foreground"
              data-testid="tx-builder-build-result-message"
            >
              {result.message}
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          title="Dismiss"
          onClick={onDismiss}
          data-testid="tx-builder-build-result-dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  const { result: built } = result;

  async function copyCbor() {
    try {
      await navigator.clipboard.writeText(built.unsignedTx);
      toast({
        title: "Unsigned transaction copied",
        description: "The transaction CBOR is on your clipboard.",
        duration: 4000,
      });
    } catch (error) {
      console.error("copy build CBOR", error);
      toast({
        title: "Couldn't copy",
        description: "Your browser blocked clipboard access.",
        duration: 6000,
        variant: "destructive",
      });
    }
  }

  return (
    <div
      data-testid="tx-builder-build-result"
      data-status="ok"
      className="flex items-start justify-between gap-3 rounded-md border border-green-500/50 bg-green-500/10 px-3 py-2 text-sm"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500 dark:text-green-400" />
          <span className="font-medium">Transaction builds</span>
          <span className="text-xs text-muted-foreground">
            &mdash; fee, inputs and change are shown on the canvas; nothing
            was signed or saved
          </span>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Stat label="Fee">
            <span data-testid="tx-builder-build-result-fee">
              {lovelaceToAda(built.fee)}
            </span>
          </Stat>
          <Stat label="Unsigned size">{built.sizeBytes.toLocaleString()} B</Stat>
          <Stat label="Inputs / outputs">
            {built.inputCount} / {built.outputCount}
          </Stat>
          <Stat label="Tx hash">
            <span
              className="font-mono text-xs"
              title={built.txHash}
              data-testid="tx-builder-build-result-hash"
            >
              {getFirstAndLast(built.txHash, 8, 8)}
            </span>
          </Stat>
        </div>
        {hasPendingRationaleEdits && (
          <p className="text-xs text-muted-foreground">
            Edited vote rationales are uploaded when you propose; this build
            used the current anchors.
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void copyCbor()}
          data-testid="tx-builder-copy-cbor"
        >
          <Copy className="mr-2 h-3.5 w-3.5" />
          Copy CBOR
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Dismiss"
          onClick={onDismiss}
          data-testid="tx-builder-build-result-dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
