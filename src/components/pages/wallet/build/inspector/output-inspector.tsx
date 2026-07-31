import { useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";

import { resolveAdaHandle } from "@/components/common/cardano-objects/resolve-adahandle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import useAddressLabels from "@/hooks/useAddressLabels";
import { baseToDisplay, displayToBase } from "@/lib/tx-draft/decimal";
import type { DraftIssue } from "@/lib/tx-draft/validate";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import { useWalletsStore } from "@/lib/zustand/wallets";
import type { AssetQuantity } from "@/types/token-flow";
import type { DraftOutput } from "@/types/tx-draft";
import type { Wallet } from "@/types/wallet";
import { cn } from "@/lib/utils";
import IssueList from "./issue-list";

function assetDecimals(
  unit: string,
  metadata: Record<string, { decimals: number }>,
): number {
  return unit === "lovelace" ? 6 : (metadata[unit]?.decimals ?? 0);
}

/**
 * Amount field for one asset row. Keeps the raw typed string locally so
 * intermediate states like "1." survive; pushes exact base units into the
 * draft on every valid change. Remounted (keyed) per output+unit.
 */
function AmountInput({
  base,
  decimals,
  onBase,
}: {
  base: string;
  decimals: number;
  onBase: (base: string) => void;
}) {
  const [display, setDisplay] = useState(() =>
    base === "0" ? "" : baseToDisplay(base, decimals),
  );
  return (
    <Input
      type="number"
      inputMode="decimal"
      min="0"
      step="any"
      placeholder="0"
      value={display}
      onChange={(event) => {
        const value = event.target.value;
        setDisplay(value);
        onBase(value.trim() === "" ? "0" : (displayToBase(value, decimals) ?? "0"));
      }}
    />
  );
}

export default function OutputInspector({
  appWallet,
  output,
  issues,
}: {
  appWallet: Wallet;
  output: DraftOutput;
  issues: DraftIssue[];
}) {
  const { labelAddress } = useAddressLabels(appWallet);
  const walletAssets = useWalletsStore((state) => state.walletAssets);
  const walletAssetMetadata = useWalletsStore(
    (state) => state.walletAssetMetadata,
  );
  const updateOutput = useTxBuilderStore((state) => state.updateOutput);
  const removeOutput = useTxBuilderStore((state) => state.removeOutput);

  const [addressDraft, setAddressDraft] = useState(output.address);
  const [handleTimeout, setHandleTimeout] = useState<NodeJS.Timeout | null>(
    null,
  );
  const [resolvedHandle, setResolvedHandle] = useState("");

  const addressLabel = output.address ? labelAddress(output.address) : null;

  // Wallet assets the output doesn't carry yet, offered by "Add asset".
  const assetOptions = useMemo(() => {
    const held = new Set(output.assets.map((asset) => asset.unit));
    const options: { unit: string; name: string }[] = [];
    if (!held.has("lovelace")) options.push({ unit: "lovelace", name: "ADA" });
    for (const asset of walletAssets) {
      if (asset.unit === "lovelace" || held.has(asset.unit)) continue;
      options.push({
        unit: asset.unit,
        name: walletAssetMetadata[asset.unit]?.assetName || asset.unit,
      });
    }
    return options;
  }, [output.assets, walletAssets, walletAssetMetadata]);

  const setAssets = (assets: AssetQuantity[]) =>
    updateOutput(output.id, { assets });

  const commitAddress = (value: string) => {
    setAddressDraft(value);
    updateOutput(output.id, { address: value.startsWith("$") ? "" : value });

    if (handleTimeout) clearTimeout(handleTimeout);
    if (value.startsWith("$")) {
      // Reuses the shared resolver; its array-based signature is adapted to
      // the single-address case with a one-element array.
      const timeout = setTimeout(() => {
        void resolveAdaHandle(
          setResolvedHandle,
          (addresses: string[]) => {
            const resolved = addresses[0];
            if (resolved) {
              setAddressDraft(resolved);
              updateOutput(output.id, { address: resolved });
            }
          },
          [value],
          0,
          value,
        );
      }, 1000);
      setHandleTimeout(timeout);
    } else {
      setResolvedHandle("");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Recipient</h3>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs text-red-500 hover:text-red-600"
          data-testid="tx-builder-remove-output"
          onClick={() => removeOutput(output.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remove
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Address</Label>
        <div className="flex items-center gap-2">
          <Input
            data-testid="tx-builder-output-address"
            type="text"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="addr1... or $handle"
            value={addressDraft}
            onChange={(event) => commitAddress(event.target.value)}
          />
          {addressLabel?.label && (
            <Badge
              variant="outline"
              className={cn(
                "shrink-0",
                addressLabel.type === "self" &&
                  "border-blue-500 text-blue-700 dark:text-blue-400",
                addressLabel.type === "signer" &&
                  "border-green-500 text-green-700 dark:text-green-400",
                addressLabel.type === "contact" &&
                  "border-purple-500 text-purple-700 dark:text-purple-400",
              )}
            >
              {addressLabel.label}
            </Badge>
          )}
        </div>
        {resolvedHandle && (
          <div className="text-xs text-muted-foreground">{resolvedHandle}</div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-xs">Amounts</Label>
        {output.assets.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No assets yet — add one below.
          </p>
        )}
        {output.assets.map((asset) => (
          <div
            key={`${output.id}:${asset.unit}`}
            className="flex items-center gap-2"
          >
            <div className="w-[110px] shrink-0">
              <AmountInput
                base={asset.quantity}
                decimals={assetDecimals(asset.unit, walletAssetMetadata)}
                onBase={(base) =>
                  setAssets(
                    output.assets.map((entry) =>
                      entry.unit === asset.unit
                        ? { ...entry, quantity: base }
                        : entry,
                    ),
                  )
                }
              />
            </div>
            <span className="min-w-0 flex-1 truncate text-xs">
              {asset.unit === "lovelace"
                ? "ADA"
                : walletAssetMetadata[asset.unit]?.assetName || asset.unit}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              onClick={() =>
                setAssets(
                  output.assets.filter((entry) => entry.unit !== asset.unit),
                )
              }
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        {assetOptions.length > 0 && (
          <Select
            value=""
            onValueChange={(unit) =>
              setAssets([...output.assets, { unit, quantity: "0" }])
            }
          >
            <SelectTrigger className="h-8 w-fit gap-1 text-xs">
              <Plus className="h-3.5 w-3.5" />
              <SelectValue placeholder="Add asset" />
            </SelectTrigger>
            <SelectContent>
              {assetOptions.map((option) => (
                <SelectItem key={option.unit} value={option.unit}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <IssueList issues={issues} />
    </div>
  );
}
