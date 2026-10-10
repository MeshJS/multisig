import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { describeSource } from "@/lib/tx-draft/source";
import type { DraftSource, DraftSourceKind } from "@/types/tx-draft";
import { getFirstAndLast } from "@/utils/strings";

export type SourcePickerProps = {
  source: DraftSource;
  /** Resolved source address; "" while unknown. */
  sourceAddress: string;
  /** Connected signer wallet, if any. */
  connected: { available: boolean; name?: string };
  /** When set, the picker is locked (editing a pending multisig tx). */
  disabledReason?: string;
  /** The page decides whether a switch needs confirmation first. */
  onRequestSource: (next: DraftSource) => void;
};

/**
 * "Source & change" block of the tx inspector: which wallet funds the
 * transaction. Change always returns to the source — a configurable change
 * address could quietly drain a wallet's remaining funds elsewhere.
 */
export default function SourcePicker({
  source,
  sourceAddress,
  connected,
  disabledReason,
  onRequestSource,
}: SourcePickerProps) {
  function onKindChange(kind: DraftSourceKind) {
    if (kind === source.kind) return;
    if (kind === "multisig") onRequestSource({ kind: "multisig" });
    else if (kind === "connected") onRequestSource({ kind: "connected" });
    else onRequestSource({ kind: "address", address: "" });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">Source wallet (funds &amp; change)</Label>
      <Select
        value={source.kind}
        onValueChange={(value) => onKindChange(value as DraftSourceKind)}
        disabled={!!disabledReason}
      >
        <SelectTrigger
          data-testid="tx-builder-source-kind"
          className="h-8 text-xs"
          title={disabledReason}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="multisig">
            {describeSource({ kind: "multisig" })}
          </SelectItem>
          <SelectItem
            value="connected"
            disabled={!connected.available}
            title={
              connected.available
                ? undefined
                : "Connect a wallet to use it as the source"
            }
          >
            {describeSource(
              { kind: "connected" },
              { walletName: connected.name },
            )}
          </SelectItem>
          <SelectItem value="address">Other address…</SelectItem>
        </SelectContent>
      </Select>
      {source.kind === "address" && (
        <Input
          data-testid="tx-builder-source-address"
          value={source.address}
          placeholder="addr… of a wallet you control"
          className="h-8 font-mono text-xs"
          disabled={!!disabledReason}
          onChange={(event) =>
            onRequestSource({ kind: "address", address: event.target.value })
          }
        />
      )}
      <div className="flex flex-col rounded-md border border-border/50 px-3 py-1.5 text-xs">
        {sourceAddress ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            {getFirstAndLast(sourceAddress, 10, 6)}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">
            {source.kind === "connected"
              ? "No wallet connected"
              : "No source address yet"}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground">
          Change returns to the source wallet.
        </span>
      </div>
      {source.kind !== "multisig" && (
        <p className="text-[10px] text-muted-foreground">
          Staking actions and votes need the multisig&apos;s credentials and
          are unavailable for other sources.
        </p>
      )}
    </div>
  );
}
