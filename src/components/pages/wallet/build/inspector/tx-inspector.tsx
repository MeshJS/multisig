import { useCallback, useMemo } from "react";
import type { UTxO } from "@meshsdk/core";
import { ChevronDown, X } from "lucide-react";

import UTxOSelector from "@/components/pages/wallet/new-transaction/utxoSelector";
import { Button } from "@/components/ui/button";
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
import useProposalTitles from "@/hooks/useProposalTitles";
import { baseToDisplay } from "@/lib/tx-draft/decimal";
import type { DraftIssue } from "@/lib/tx-draft/validate";
import { useSiteStore } from "@/lib/zustand/site";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import { useWalletsStore } from "@/lib/zustand/wallets";
import type { DraftVoteKind } from "@/types/tx-draft";
import type { Wallet } from "@/types/wallet";
import { getFirstAndLast } from "@/utils/strings";
import IssueList from "./issue-list";
import VoteRationaleEditor from "./vote-rationale-editor";

const VOTE_KIND_COLORS: Record<DraftVoteKind, string> = {
  Yes: "text-green-500 dark:text-green-400",
  No: "text-red-500 dark:text-red-400",
  Abstain: "text-muted-foreground",
};

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
  const setUtxoSelection = useTxBuilderStore((state) => state.setUtxoSelection);
  const updateVoteKind = useTxBuilderStore((state) => state.updateVoteKind);
  const removeVote = useTxBuilderStore((state) => state.removeVote);

  const voteProposalIds = useMemo(
    () =>
      draft.votes.map(
        (vote) => `${vote.govActionTxHash}#${vote.govActionIndex}`,
      ),
    [draft.votes],
  );
  const { resolveProposalTitle } = useProposalTitles(
    appWallet.id,
    voteProposalIds,
  );

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
        {/* Fixed to the wallet itself: a configurable change address could
            quietly drain the wallet's remaining funds to another address. */}
        <div className="flex flex-col rounded-md border border-border/50 px-3 py-1.5 text-xs">
          <span>Self (Multisig)</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {getFirstAndLast(appWallet.address, 10, 6)}
          </span>
        </div>
      </div>

      {draft.votes.length > 0 && (
        <Collapsible defaultOpen>
          <CollapsibleTrigger
            data-testid="tx-builder-votes-toggle"
            className="flex w-full items-center justify-between rounded-md border border-border/50 px-2.5 py-1.5 text-xs font-medium hover:bg-muted/50"
          >
            <span>Votes — {draft.votes.length}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-2 pt-2">
            {draft.votes.map((vote) => {
              const proposalId = `${vote.govActionTxHash}#${vote.govActionIndex}`;
              const title = resolveProposalTitle(proposalId);
              return (
                <div
                  key={vote.id}
                  data-testid={`tx-builder-vote-${vote.id}`}
                  className="flex flex-col gap-1.5 rounded-md border border-border/50 p-2"
                >
                  <span
                    className="truncate text-xs font-medium"
                    title={title ?? proposalId}
                  >
                    {title ?? "Governance action"}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {getFirstAndLast(vote.govActionTxHash, 8, 4)}#
                    {vote.govActionIndex}
                  </span>
                  <div className="flex items-center gap-2">
                    <Select
                      value={vote.voteKind}
                      onValueChange={(value) =>
                        updateVoteKind(vote.id, value as DraftVoteKind)
                      }
                    >
                      <SelectTrigger
                        data-testid={`tx-builder-vote-kind-${vote.id}`}
                        className={`h-8 flex-1 text-xs font-medium ${VOTE_KIND_COLORS[vote.voteKind]}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(["Yes", "No", "Abstain"] as const).map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            <span className={VOTE_KIND_COLORS[kind]}>
                              {kind}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      title="Remove this vote from the transaction"
                      data-testid={`tx-builder-vote-remove-${vote.id}`}
                      onClick={() => removeVote(vote.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <VoteRationaleEditor walletId={appWallet.id} vote={vote} />
                </div>
              );
            })}
            <p className="text-[10px] text-muted-foreground">
              Changing a vote keeps its attached rationale unless cleared or
              edited — editing uploads a new rationale document when you
              build. New votes are cast from the Governance pages.
            </p>
          </CollapsibleContent>
        </Collapsible>
      )}

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
