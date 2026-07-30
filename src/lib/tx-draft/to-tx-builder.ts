import { keepRelevant, type MeshTxBuilder, type UTxO } from "@meshsdk/core";

import type { TxDraft } from "@/types/tx-draft";
import { materializeOutputAssets, requiredAssetTotals } from "./assets";

export type ApplyDraftContext = {
  /** The multisig payment script; every input is a script input. */
  scriptCbor: string;
  /** The multisig wallet address; default change target. */
  walletAddress: string;
  /** Spendable UTxOs (pending-blocked ones excluded); used in auto mode. */
  availableUtxos: UTxO[];
};

/**
 * Applies a validated draft to a MeshTxBuilder. The builder is injected so
 * tests can inspect `meshTxBuilderBody` without a network provider.
 *
 * Manual UTxO selections are used exactly as picked — unlike the legacy form,
 * which re-filtered manual picks through `keepRelevant` and could silently
 * drop them. Sufficiency is guaranteed by `validateDraft` instead.
 */
export function applyDraftToTxBuilder(
  txBuilder: MeshTxBuilder,
  draft: TxDraft,
  ctx: ApplyDraftContext,
): MeshTxBuilder {
  if (draft.outputs.length === 0) {
    throw new Error("Draft has no outputs");
  }

  let selectedUtxos: UTxO[];
  if (draft.utxoSelection.mode === "manual") {
    selectedUtxos = draft.utxoSelection.utxos;
  } else {
    const assetMap = new Map<string, string>();
    for (const [unit, quantity] of requiredAssetTotals(draft)) {
      assetMap.set(unit, quantity.toString());
    }
    selectedUtxos = keepRelevant(assetMap, ctx.availableUtxos);
  }
  if (selectedUtxos.length === 0) {
    throw new Error("Insufficient funds: no UTxOs selected");
  }

  for (const utxo of selectedUtxos) {
    txBuilder
      .txIn(
        utxo.input.txHash,
        utxo.input.outputIndex,
        utxo.output.amount,
        utxo.output.address,
      )
      .txInScript(ctx.scriptCbor);
  }

  for (const output of draft.outputs) {
    txBuilder.txOut(output.address, materializeOutputAssets(output.assets));
  }

  txBuilder.changeAddress(draft.changeAddress ?? ctx.walletAddress);

  return txBuilder;
}
