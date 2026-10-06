import { useEffect, useMemo, useRef } from "react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { validatePlutusData } from "@/lib/tx-draft/plutus-data";
import type { DraftPlutusData } from "@/types/tx-draft";

/** Controlled editor shared by output datums and future input datum/redeemer fields. */
export default function PlutusDataEditor({
  id,
  label,
  value,
  onChange,
  focusToken,
}: {
  id: string;
  label: string;
  value: DraftPlutusData;
  onChange: (value: DraftPlutusData) => void;
  focusToken?: object;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const result = useMemo(() => validatePlutusData(value), [value]);
  useEffect(() => {
    if (focusToken) textarea.current?.focus();
  }, [focusToken]);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <Select
          value={value.format}
          onValueChange={(format: DraftPlutusData["format"]) => {
            onChange({
              format,
              text: result.valid
                ? format === "CBOR"
                  ? result.cbor
                  : result.json
                : value.text,
            });
          }}
        >
          <SelectTrigger className="h-8 w-28" aria-label={`${label} format`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CBOR">CBOR hex</SelectItem>
            <SelectItem value="JSON">Plutus JSON</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Textarea
        id={id}
        ref={textarea}
        value={value.text}
        spellCheck={false}
        className="min-h-28 font-mono text-xs"
        aria-invalid={!result.valid}
        aria-describedby={`${id}-help ${id}-status`}
        onChange={(event) => onChange({ ...value, text: event.target.value })}
        placeholder={
          value.format === "CBOR" ? "d87980" : '{"constructor":0,"fields":[]}'
        }
      />
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {value.format === "JSON"
          ? "Use Plutus JSON, with quoted decimal strings for large integers."
          : "Enter one complete Plutus value as CBOR hex."}
      </p>
      <p
        id={`${id}-status`}
        role={result.valid ? "status" : "alert"}
        className={
          result.valid
            ? "text-xs text-muted-foreground"
            : "text-xs text-destructive"
        }
      >
        {result.valid
          ? `Valid data · ${result.cbor.length / 2} ${result.cbor.length === 2 ? "byte" : "bytes"}`
          : result.error}
      </p>
      {result.valid && (
        <details className="text-xs">
          <summary className="cursor-pointer">Decoded preview</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">
            {result.json}
          </pre>
        </details>
      )}
    </div>
  );
}
