import { useCallback, useMemo } from "react";
import type { UTxO } from "@meshsdk/core";
import { ChevronDown } from "lucide-react";

import UTxOSelector from "@/components/pages/wallet/new-transaction/utxoSelector";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { baseToDisplay } from "@/lib/tx-draft/decimal";
import type { DraftIssue } from "@/lib/tx-draft/validate";
import { useSiteStore } from "@/lib/zustand/site";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import { useWalletsStore } from "@/lib/zustand/wallets";
import type { Wallet } from "@/types/wallet";
import { getFirstAndLast } from "@/utils/strings";
import IssueList from "./issue-list";

export default function TxInspector({
  appWallet,
  issues,
}: {
  appWallet: Wallet;
  issues: DraftIssue[];
}) {
  const network = useSiteStore((state) => state.network);
  const walletAssetMetadata = useWalletsStore(
    (state) => state.walletAssetMetadata,
  );
  const draft = useTxBuilderStore((state) => state.draft);
  const setDescription = useTxBuilderStore((state) => state.setDescription);
  const setMetadata = useTxBuilderStore((state) => state.setMetadata);
  const setChangeAddress = useTxBuilderStore((state) => state.setChangeAddress);
  const setUtxoSelection = useTxBuilderStore((state) => state.setUtxoSelection);

  const changeOptions = useMemo(() => {
    const options = [
      { address: appWallet.address, label: "Self (Multisig)" },
    ];
    appWallet.signersAddresses?.forEach((address, index) => {
      if (address !== appWallet.address) {
        options.push({
          address,
          label:
            appWallet.signersDescriptions?.[index] || `Signer ${index + 1}`,
        });
      }
    });
    return options;
  }, [appWallet]);

  // The UTxO selector reports required funds per recipient in display units;
  // flatten the draft's (output, asset) pairs into its parallel arrays.
  const { recipientAmounts, recipientAssets } = useMemo(() => {
    const amounts: string[] = [];
    const units: string[] = [];
    for (const output of draft.outputs) {
      for (const asset of output.assets) {
        const decimals =
          asset.unit === "lovelace"
            ? 6
            : (walletAssetMetadata[asset.unit]?.decimals ?? 0);
        amounts.push(baseToDisplay(asset.quantity, decimals));
        units.push(asset.unit);
      }
    }
    return { recipientAmounts: amounts, recipientAssets: units };
  }, [draft.outputs, walletAssetMetadata]);

  const onUtxoSelectionChange = useCallback(
    (selectedUtxos: UTxO[], manualSelected: boolean) =>
      setUtxoSelection(
        manualSelected
          ? { mode: "manual", utxos: selectedUtxos }
          : { mode: "auto" },
      ),
    [setUtxoSelection],
  );

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold">Transaction</h3>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Description (off-chain, for signers)</Label>
        <Input
          data-testid="tx-builder-description"
          value={draft.description}
          maxLength={128}
          placeholder="What is this transaction for?"
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">On-chain metadata (label 674)</Label>
        <Input
          data-testid="tx-builder-metadata"
          value={draft.metadata}
          maxLength={64}
          placeholder="Optional public note"
          onChange={(event) => setMetadata(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Change address</Label>
        <Select
          value={draft.changeAddress ?? appWallet.address}
          onValueChange={(value) =>
            setChangeAddress(value === appWallet.address ? undefined : value)
          }
        >
          <SelectTrigger className="h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {changeOptions.map((option) => (
              <SelectItem key={option.address} value={option.address}>
                <span className="flex flex-col items-start">
                  <span>{option.label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {getFirstAndLast(option.address, 10, 6)}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Collapsible>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border/50 px-2.5 py-1.5 text-xs font-medium hover:bg-muted/50">
          <span>
            UTxOs —{" "}
            {draft.utxoSelection.mode === "manual"
              ? `${draft.utxoSelection.utxos.length} manually selected`
              : "automatic selection"}
          </span>
          <ChevronDown className="h-3.5 w-3.5" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <UTxOSelector
            appWallet={appWallet}
            network={network}
            onSelectionChange={onUtxoSelectionChange}
            recipientAmounts={recipientAmounts}
            recipientAssets={recipientAssets}
          />
        </CollapsibleContent>
      </Collapsible>

      <IssueList issues={issues} />
    </div>
  );
}
