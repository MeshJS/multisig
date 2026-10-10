import { useEffect, useState } from "react";

import PoolSelector from "@/components/pages/wallet/staking/poolSelector";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { GLASS_DIALOG_CLASS } from "@/components/common/token-flow/flow-canvas";
import type { StakeActionInput } from "@/lib/tx-draft/mutations";
import { useSiteStore } from "@/lib/zustand/site";
import { cn } from "@/lib/utils";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import { getProvider } from "@/utils/get-provider";
import { normalizePoolIdForDelegation } from "@/utils/normalizePoolId";
import { getFirstAndLast } from "@/utils/strings";

type StakeActionType = StakeActionInput["type"];

const ACTION_LABELS: Record<StakeActionType, string> = {
  registerAndDelegate: "Register & delegate",
  delegate: "Change delegation",
  deregister: "Deregister",
};

/**
 * On-chain registration state of the wallet's reward account, fetched when
 * the dialog opens. `null` = still loading, `"error"` = fetch failed (all
 * actions stay available behind a warning instead of blocking the user).
 */
type AccountState =
  | { active: boolean; poolId: string | null }
  | null
  | "error";

/**
 * Adds a staking action (as its certificate(s)) to the draft. The offered
 * actions follow the account's registration state so the user can't compose
 * a cert that is guaranteed to fail on-chain: register+delegate when not
 * registered, delegate/deregister when registered.
 *
 * For pool-requiring actions, picking a pool (from the browser or via the
 * manual input's Apply) commits the action and closes the dialog in one
 * click — mirroring the certificate editor's "Change pool" dialog. Only
 * deregister, having no pool to pick, uses the footer confirm button.
 */
export default function AddStakeDialog({
  open,
  onOpenChange,
  stakeAddress,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The wallet's reward address (from the derived stake context). */
  stakeAddress: string;
}) {
  const network = useSiteStore((state) => state.network);
  const addStakeAction = useTxBuilderStore((state) => state.addStakeAction);

  const [accountState, setAccountState] = useState<AccountState>(null);
  const [actionType, setActionType] = useState<StakeActionType | null>(null);
  const [manualPoolId, setManualPoolId] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAccountState(null);
    setActionType(null);
    setManualPoolId("");
    setManualError(null);
    let cancelled = false;
    getProvider(network)
      .get(`/accounts/${stakeAddress}`)
      .then((data: { active?: boolean; pool_id?: string | null }) => {
        if (cancelled) return;
        const active = data.active === true;
        setAccountState({ active, poolId: data.pool_id ?? null });
        setActionType(active ? "delegate" : "registerAndDelegate");
      })
      .catch(() => {
        if (!cancelled) setAccountState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [open, network, stakeAddress]);

  const availableActions: StakeActionType[] =
    accountState === "error"
      ? ["registerAndDelegate", "delegate", "deregister"]
      : accountState?.active
        ? ["delegate", "deregister"]
        : ["registerAndDelegate"];

  const needsPool =
    actionType === "registerAndDelegate" || actionType === "delegate";

  /** Picking a pool IS the confirmation for pool-requiring actions. */
  function commitWithPool(raw: string) {
    if (actionType !== "registerAndDelegate" && actionType !== "delegate") {
      return;
    }
    try {
      const poolId = normalizePoolIdForDelegation(raw);
      addStakeAction({ type: actionType, poolId });
      onOpenChange(false);
    } catch {
      setManualError(
        "Invalid pool id — expected bech32 pool1... or 56-character hex.",
      );
    }
  }

  function onConfirmDeregister() {
    addStakeAction({ type: "deregister" });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Header and footer stay pinned; only the middle scrolls, so the
          footer buttons are never pushed out of view by the pool browser. */}
      <DialogContent
        className={cn("flex max-h-[80vh] flex-col sm:max-w-4xl", GLASS_DIALOG_CLASS)}
      >
        <DialogHeader>
          <DialogTitle>Add staking action</DialogTitle>
          <DialogDescription>
            Picking a stake pool adds the action to this transaction as its
            staking certificate(s), proposed to the signers when you build.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-2">
        {accountState === null && (
          <p className="text-sm text-muted-foreground">
            Checking the wallet&apos;s stake registration…
          </p>
        )}
        {accountState === "error" && (
          <p className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs">
            Couldn&apos;t check the current registration state — pick the
            action that matches it, or the transaction will fail on-chain.
          </p>
        )}
        {accountState !== null && accountState !== "error" && (
          <p className="text-xs text-muted-foreground">
            {accountState.active ? (
              <>
                Stake key is registered
                {accountState.poolId ? (
                  <>
                    , currently delegated to{" "}
                    <span
                      className="font-mono"
                      title={accountState.poolId}
                    >
                      {getFirstAndLast(accountState.poolId, 12, 6)}
                    </span>
                  </>
                ) : (
                  ", not delegated to a pool"
                )}
                .
              </>
            ) : (
              <>Stake key is not registered yet.</>
            )}
          </p>
        )}

        {accountState !== null && (
          <div className="flex flex-wrap gap-2">
            {availableActions.map((action) => (
              <Button
                key={action}
                variant={actionType === action ? "default" : "outline"}
                size="sm"
                data-testid={`tx-builder-stake-action-${action}`}
                onClick={() => setActionType(action)}
              >
                {ACTION_LABELS[action]}
              </Button>
            ))}
          </div>
        )}

        {needsPool && (
          <>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Input
                  data-testid="tx-builder-stake-pool-input"
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
                  data-testid="tx-builder-stake-pool-apply"
                  onClick={() => commitWithPool(manualPoolId)}
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
            <PoolSelector onSelect={(poolHex) => commitWithPool(poolHex)} />
          </>
        )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {actionType === "deregister" && (
            <Button
              data-testid="tx-builder-stake-confirm"
              onClick={onConfirmDeregister}
            >
              Add to transaction
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
