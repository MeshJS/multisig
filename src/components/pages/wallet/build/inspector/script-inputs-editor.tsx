import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DraftScriptInputsState } from "@/hooks/useDraftScriptInputs";
import { validatePlutusData } from "@/lib/tx-draft/plutus-data";
import type { DraftIssue } from "@/lib/tx-draft/validate";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import type { DraftScriptInput } from "@/types/tx-draft";
import IssueList from "./issue-list";
import PlutusDataEditor from "./plutus-data-editor";

export default function ScriptInputsEditor({
  state,
  issues,
}: {
  state: DraftScriptInputsState;
  issues: DraftIssue[];
}) {
  const draft = useTxBuilderStore((s) => s.draft);
  const selection = useTxBuilderStore((s) => s.selection);
  const add = useTxBuilderStore((s) => s.addScriptInput);
  const update = useTxBuilderStore((s) => s.updateScriptInput);
  const remove = useTxBuilderStore((s) => s.removeScriptInput);
  const [open, setOpen] = useState(draft.scriptInputs.length > 0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selection?.kind !== "tx" || !selection.inputId) return;
    setOpen(true);
    // Wait for CollapsibleContent to mount before focusing the selected field.
    const timer = setTimeout(() => {
      const element = document.getElementById(
        `script-${selection.inputId}-${selection.field ?? "utxoRef"}`,
      );
      if (element && root.current?.contains(element)) element.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [selection]);
  return (
    <div ref={root}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          data-testid="tx-builder-script-advanced"
          className="flex w-full items-center justify-between rounded-md border border-border/50 px-2.5 py-1.5 text-xs font-medium hover:bg-muted/50"
        >
          <span>
            Advanced · Script inputs
            {draft.scriptInputs.length ? ` (${draft.scriptInputs.length})` : ""}
          </span>
          <ChevronDown className="h-3.5 w-3.5" />
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-3 pt-2">
          <p className="text-xs text-muted-foreground">
            Configure already-parameterized Plutus scripts. Data validation does
            not evaluate the contract. Script spending will be enabled after
            collateral and evaluated builds are available.
          </p>
          {draft.scriptInputs.map((input, index) => {
            const resolved = state.resolutions.find(
              (entry) => entry.inputId === input.id,
            );
            const inline = resolved?.utxo?.output.plutusData;
            const preview = inline
              ? validatePlutusData({ format: "CBOR", text: inline })
              : undefined;
            const id = (field: string) => `script-${input.id}-${field}`;
            return (
              <div
                key={input.id}
                data-testid="tx-builder-script-input"
                className="flex min-w-0 flex-col gap-2 rounded-md border border-border/50 p-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">
                    Script input {index + 1}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(input.id)}
                  >
                    Remove input
                  </Button>
                </div>
                <Label htmlFor={id("utxoRef")}>Transaction hash</Label>
                <Input
                  id={id("utxoRef")}
                  value={input.utxoRef.txHash}
                  spellCheck={false}
                  onChange={(e) =>
                    update(input.id, {
                      utxoRef: {
                        ...input.utxoRef,
                        txHash: e.target.value.trim(),
                      },
                    })
                  }
                />
                <Label htmlFor={id("index")}>Output index</Label>
                <Input
                  id={id("index")}
                  type="number"
                  min={0}
                  max={65535}
                  step={1}
                  value={
                    Number.isNaN(input.utxoRef.outputIndex)
                      ? ""
                      : input.utxoRef.outputIndex
                  }
                  onChange={(e) =>
                    update(input.id, {
                      utxoRef: {
                        ...input.utxoRef,
                        outputIndex: e.target.valueAsNumber,
                      },
                    })
                  }
                />
                {resolved?.utxo && (
                  <div
                    className="space-y-1 break-all rounded bg-muted p-2 text-xs"
                    data-testid="script-input-chain-data"
                  >
                    <p>On-chain address: {resolved.utxo.output.address}</p>
                    {resolved.utxo.output.amount.map((asset) => (
                      <p key={asset.unit}>
                        {asset.quantity}{" "}
                        {asset.unit === "lovelace" ? "lovelace" : asset.unit}
                      </p>
                    ))}
                    <p>
                      Datum:{" "}
                      {inline
                        ? "inline"
                        : (resolved.utxo.output.dataHash ?? "none")}
                    </p>
                    {preview?.valid && (
                      <details>
                        <summary>On-chain datum preview</summary>
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap">
                          {preview.json}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
                <Label htmlFor={id("version")}>Plutus version</Label>
                <Select
                  value={input.script.version}
                  onValueChange={(
                    version: DraftScriptInput["script"]["version"],
                  ) =>
                    update(input.id, { script: { ...input.script, version } })
                  }
                >
                  <SelectTrigger id={id("version")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["V1", "V2", "V3"] as const).map((version) => (
                      <SelectItem key={version} value={version}>
                        {version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label htmlFor={id("script")}>Script CBOR</Label>
                <Textarea
                  id={id("script")}
                  value={input.script.cbor}
                  spellCheck={false}
                  className="font-mono text-xs"
                  onChange={(e) =>
                    update(input.id, {
                      script: { ...input.script, cbor: e.target.value.trim() },
                    })
                  }
                />
                <Label htmlFor={id("datumSource")}>Datum source</Label>
                <Select
                  value={input.datumSource.kind}
                  onValueChange={(kind: "inline" | "provided") =>
                    update(input.id, {
                      datumSource:
                        kind === "inline"
                          ? { kind }
                          : { kind, data: { format: "CBOR", text: "" } },
                    })
                  }
                >
                  <SelectTrigger id={id("datumSource")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inline">
                      On-chain inline datum
                    </SelectItem>
                    <SelectItem value="provided">
                      Supply datum matching hash
                    </SelectItem>
                  </SelectContent>
                </Select>
                {input.datumSource.kind === "provided" && (
                  <PlutusDataEditor
                    id={id("datum")}
                    label="Supplied datum"
                    value={input.datumSource.data}
                    onChange={(data) =>
                      update(input.id, {
                        datumSource: { kind: "provided", data },
                      })
                    }
                  />
                )}
                <PlutusDataEditor
                  id={id("redeemer")}
                  label="Redeemer"
                  value={input.redeemer}
                  onChange={(redeemer) => update(input.id, { redeemer })}
                />
                <IssueList
                  issues={issues.filter((issue) => issue.inputId === input.id)}
                />
                {resolved && resolved.issues.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Chain data and data formats verified. Contract evaluation is
                    still required.
                  </p>
                )}
              </div>
            );
          })}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => add()}>
              Add script input
            </Button>
            {draft.scriptInputs.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={state.loading}
                onClick={state.retry}
              >
                {state.loading ? "Resolving…" : "Recheck chain"}
              </Button>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
