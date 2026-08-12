import { useState } from "react";
import { X } from "lucide-react";

import PoolSelector from "@/components/pages/wallet/staking/poolSelector";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import type { DraftCertificate, DraftCertificateKind } from "@/types/tx-draft";
import { normalizePoolIdForDelegation } from "@/utils/normalizePoolId";
import { getFirstAndLast } from "@/utils/strings";

const CERT_KIND_LABELS: Record<DraftCertificateKind, string> = {
  RegisterStake: "Stake Registration",
  DelegateStake: "Stake Delegation",
  DeregisterStake: "Stake Deregistration",
};

/**
 * One staking certificate row in the tx inspector. The target pool of a
 * delegation certificate is editable — via the pool browser or a manual pool
 * id (bech32 or hex, canonicalized to bech32 on apply). Certificates added
 * in the builder are removable (a register+delegate pair as a unit); ones
 * loaded from a pending transaction are not, since dropping one would
 * rebuild a chain-invalid or pointless transaction.
 */
export default function CertificateEditor({
  certificate,
}: {
  certificate: DraftCertificate;
}) {
  const updateCertificatePool = useTxBuilderStore(
    (state) => state.updateCertificatePool,
  );
  const removeCertificate = useTxBuilderStore(
    (state) => state.removeCertificate,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [manualPoolId, setManualPoolId] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  function applyPoolId(raw: string) {
    try {
      updateCertificatePool(certificate.id, normalizePoolIdForDelegation(raw));
      setDialogOpen(false);
      setManualPoolId("");
      setManualError(null);
    } catch {
      setManualError(
        "Invalid pool id — expected bech32 pool1... or 56-character hex.",
      );
    }
  }

  return (
    <div
      data-testid={`tx-builder-cert-${certificate.id}`}
      className="flex flex-col gap-1.5 rounded-md border border-border/50 p-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">
          {CERT_KIND_LABELS[certificate.kind]}
        </span>
        {certificate.origin === "user" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            title={
              certificate.pairId
                ? "Removes the registration + delegation pair from the transaction"
                : "Remove this staking action from the transaction"
            }
            data-testid={`tx-builder-cert-remove-${certificate.id}`}
            onClick={() => removeCertificate(certificate.id)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {certificate.originalStakeAddress && (
        <span
          className="font-mono text-[10px] text-muted-foreground"
          title={certificate.originalStakeAddress}
        >
          {getFirstAndLast(certificate.originalStakeAddress, 10, 6)}
        </span>
      )}
      {certificate.kind === "DelegateStake" && (
        <div className="flex items-center justify-between gap-2">
          <span
            data-testid={`tx-builder-cert-pool-${certificate.id}`}
            className="truncate font-mono text-[10px]"
            title={certificate.poolId}
          >
            {certificate.poolId
              ? getFirstAndLast(certificate.poolId, 12, 6)
              : "No pool selected"}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 text-xs"
            data-testid={`tx-builder-cert-change-pool-${certificate.id}`}
            onClick={() => setDialogOpen(true)}
          >
            Change pool
          </Button>
        </div>
      )}
      {certificate.kind === "DelegateStake" && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>Change stake pool</DialogTitle>
              <DialogDescription>
                Pick a pool from the list, or paste a pool id (bech32
                pool1... or hex).
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Input
                  data-testid={`tx-builder-cert-pool-input-${certificate.id}`}
                  value={manualPoolId}
                  placeholder="pool1... or 56-character hex"
                  onChange={(event) => {
                    setManualPoolId(event.target.value);
                    setManualError(null);
                  }}
                />
                <Button
                  size="sm"
                  disabled={!manualPoolId.trim()}
                  data-testid={`tx-builder-cert-pool-apply-${certificate.id}`}
                  onClick={() => applyPoolId(manualPoolId)}
                >
                  Apply
                </Button>
              </div>
              {manualError && (
                <p className="text-xs text-red-500 dark:text-red-400">
                  {manualError}
                </p>
              )}
            </div>
            <PoolSelector onSelect={(poolHex) => applyPoolId(poolHex)} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
