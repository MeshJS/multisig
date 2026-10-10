import type { DraftIssue } from "@/lib/tx-draft/validate";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import type { Wallet } from "@/types/wallet";
import type { SourcePickerProps } from "../source-picker";
import OutputInspector from "./output-inspector";
import TxInspector, { type TxInspectorSourceProps } from "./tx-inspector";

export type { TxInspectorSourceProps };

/**
 * Selection-driven side panel: an output card opens its recipient form, any
 * other selection (or none) opens the transaction form. Edge clicks are
 * resolved to output/tx before they reach the store, so two forms suffice.
 */
export default function Inspector({
  appWallet,
  issues,
  source,
}: {
  appWallet: Wallet;
  issues: DraftIssue[];
  /** Source picker state + UTxO source facts, owned by the page. */
  source: TxInspectorSourceProps & { picker: SourcePickerProps };
}) {
  const selection = useTxBuilderStore((state) => state.selection);
  const draft = useTxBuilderStore((state) => state.draft);

  const selectedOutput =
    selection?.kind === "output"
      ? draft.outputs.find((output) => output.id === selection.outputId)
      : undefined;

  return (
    <div
      data-testid="tx-builder-inspector"
      className="rounded-lg border border-border/50 bg-card p-3"
    >
      {selectedOutput ? (
        <OutputInspector
          key={selectedOutput.id}
          appWallet={appWallet}
          output={selectedOutput}
          issues={issues.filter((issue) => issue.outputId === selectedOutput.id)}
        />
      ) : (
        <TxInspector
          appWallet={appWallet}
          issues={issues.filter((issue) => issue.outputId === undefined)}
          source={source}
        />
      )}
    </div>
  );
}
