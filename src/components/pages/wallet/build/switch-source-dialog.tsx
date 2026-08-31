import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SwitchSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Staking certificates + votes that the switch would remove. */
  removedCount: number;
  targetLabel: string;
  onConfirm: () => void;
}

/**
 * Confirmation shown when leaving the multisig source while the draft holds
 * staking actions or votes: those need the multisig's script credentials, so
 * switching removes them from the draft.
 */
export default function SwitchSourceDialog({
  open,
  onOpenChange,
  removedCount,
  targetLabel,
  onConfirm,
}: SwitchSourceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Switch source to {targetLabel}?
          </DialogTitle>
          <DialogDescription>
            Staking actions and votes can only be built from the multisig
            wallet. Switching removes{" "}
            <span className="font-medium text-foreground">
              {removedCount} {removedCount === 1 ? "item" : "items"}
            </span>{" "}
            from the draft; recipients are kept.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep multisig
          </Button>
          <Button onClick={onConfirm} data-testid="tx-builder-switch-source-confirm">
            Switch and remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
