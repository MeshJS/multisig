import { AlertTriangle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ReplaceConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Signatures collected on the transaction being replaced. */
  signedCount: number;
  requiredCount: number;
  description?: string | null;
  busy: boolean;
  onConfirm: () => void;
}

/**
 * Confirmation shown when building while editing a pending transaction.
 * Editing changes the transaction body, so every collected witness becomes
 * invalid — the original is deleted and signers must sign the replacement.
 */
export default function ReplaceConfirmDialog({
  open,
  onOpenChange,
  signedCount,
  requiredCount,
  description,
  busy,
  onConfirm,
}: ReplaceConfirmDialogProps) {
  // The editor re-signs the replacement as part of building it, so only
  // co-signers' signatures are genuinely lost work.
  const discardsOthers = signedCount > 1;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {discardsOthers && (
              <AlertTriangle className="h-5 w-5 text-warning" />
            )}
            Replace pending transaction?
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>
                {description ? (
                  <>
                    The original proposal{" "}
                    <span className="font-medium text-foreground">
                      &ldquo;{description}&rdquo;
                    </span>{" "}
                    will be deleted and this edited version proposed in its
                    place.
                  </>
                ) : (
                  <>
                    The original proposal will be deleted and this edited
                    version proposed in its place.
                  </>
                )}
              </p>
              {discardsOthers ? (
                <p>
                  It already has{" "}
                  <span className="font-medium text-foreground">
                    {signedCount} of {requiredCount}
                  </span>{" "}
                  required signatures. Editing changes the transaction, so all
                  collected signatures become invalid and will be discarded —
                  every signer will be asked to sign again.
                </p>
              ) : (
                <p>You&apos;ll sign the new version now.</p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            variant={discardsOthers ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={busy}
            data-testid="tx-builder-replace-confirm"
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Replacing...
              </>
            ) : discardsOthers ? (
              `Discard ${signedCount} signatures and replace`
            ) : (
              "Replace transaction"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
