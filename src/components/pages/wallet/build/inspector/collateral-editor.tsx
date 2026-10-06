import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import type { DraftCollateralState } from "@/hooks/useDraftCollateral";
import { utxoRefKey } from "@/lib/tx-draft/resolve-script-inputs";
import { baseToDisplay } from "@/lib/tx-draft/decimal";

export default function CollateralEditor({
  state,
}: {
  state: DraftCollateralState;
}) {
  const draft = useTxBuilderStore((s) => s.draft);
  const setCollateral = useTxBuilderStore((s) => s.setCollateral);
  const selection = useTxBuilderStore((s) => s.selection);
  const [open, setOpen] = useState(!!draft.collateral);
  useEffect(() => {
    if (selection?.kind !== "tx" || selection.field !== "collateral") return;
    setOpen(true);
    const timer = setTimeout(
      () => document.getElementById("draft-collateral")?.focus(),
      0,
    );
    return () => clearTimeout(timer);
  }, [selection]);
  return (
    <div className="space-y-2">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          className="flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-xs"
          data-testid="tx-builder-collateral-advanced"
        >
          <span>
            Advanced · Collateral{draft.collateral ? " · selected" : ""}
          </span>
          <ChevronDown className="h-3.5 w-3.5" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          <Label htmlFor="draft-collateral" className="text-xs">
            Existing wallet collateral
          </Label>
          <Select
            disabled={!draft.scriptInputs.length || state.loading}
            value={
              draft.collateral ? utxoRefKey(draft.collateral.utxoRef) : "none"
            }
            onValueChange={(value) => {
              const candidate = state.candidates.find(
                (c) => utxoRefKey(c.utxo.input) === value,
              );
              setCollateral(
                candidate ? { utxoRef: candidate.utxo.input } : undefined,
              );
            }}
          >
            <SelectTrigger id="draft-collateral">
              <SelectValue placeholder="Select collateral" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Select collateral</SelectItem>
              {draft.collateral && !state.selected && (
                <SelectItem
                  value={utxoRefKey(draft.collateral.utxoRef)}
                  disabled
                >
                  Selection requires revalidation
                </SelectItem>
              )}
              {state.candidates.map((c) => (
                <SelectItem
                  key={utxoRefKey(c.utxo.input)}
                  value={utxoRefKey(c.utxo.input)}
                >
                  {baseToDisplay(c.lovelace, 6)} ADA ·{" "}
                  {utxoRefKey(c.utxo.input)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={state.loading || !draft.scriptInputs.length}
              onClick={state.retry}
            >
              Recheck collateral
            </Button>
            {draft.collateral && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCollateral(undefined)}
              >
                Clear
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Select one existing ADA-only UTxO. No collateral creation,
            reservation, or return is performed. Sufficiency is checked against
            the evaluated fee before signing.
          </p>
        </CollapsibleContent>
      </Collapsible>
      {state.selected && (
        <div
          className="space-y-1 break-all rounded border p-2 text-xs"
          data-testid="collateral-summary"
        >
          <p>Collateral: {utxoRefKey(state.selected.utxo.input)}</p>
          <p>Owner payment key: {state.selected.ownerKeyHash}</p>
          <p>Owner address: {state.selected.utxo.output.address}</p>
          <p>
            Selected: {baseToDisplay(state.selected.lovelace, 6)} ADA. Without a
            collateral return, this entire amount is at risk.
          </p>
          <p>
            The owner must sign the completed transaction. Final exposure and
            minimum await an evaluated build.
          </p>
        </div>
      )}
      {state.issues.map((issue) => (
        <p key={issue.code} className="text-xs text-destructive" role="status">
          {issue.message}
        </p>
      ))}
    </div>
  );
}
