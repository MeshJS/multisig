import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Exact bytes stay visible and keyboard-scrollable; copy never changes formatting. */
export default function ContractDataValue({
  label,
  value,
  identity,
  json,
}: {
  label: string;
  value: string;
  identity: string;
  json?: string;
}) {
  const [status, setStatus] = useState("");
  return (
    <div className="min-w-0 space-y-1 text-xs">
      <p
        className="max-h-40 overflow-auto whitespace-pre-wrap break-all"
        tabIndex={0}
        aria-label={`${identity} ${label}`}
      >
        {label}: <span className="font-mono">{value}</span>
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={`Copy ${identity} ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setStatus("Copied.");
          } catch {
            setStatus("Copy unavailable. Select the value to copy it.");
          }
        }}
      >
        Copy {label}
      </Button>
      <span role="status" className="ml-2">
        {status}
      </span>
      {json !== undefined && (
        <details>
          <summary className="cursor-pointer">
            Decoded {label.replace(" CBOR", "").toLowerCase()} data
          </summary>
          <pre
            tabIndex={0}
            aria-label={`${identity} decoded ${label}`}
            className="max-h-40 overflow-auto whitespace-pre-wrap break-all"
          >
            {json}
          </pre>
        </details>
      )}
    </div>
  );
}
