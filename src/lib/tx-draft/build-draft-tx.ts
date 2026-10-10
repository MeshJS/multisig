import type { MeshTxBuilder } from "@meshsdk/core";
import { resolveTxHash } from "@meshsdk/core-cst";

import type { TxDraft } from "@/types/tx-draft";
import { applyMetadataMessage } from "./metadata";
import { applyDraftToTxBuilder, type ApplyDraftContext } from "./to-tx-builder";

export type DraftBuildResult = {
  /** Unsigned transaction hex returned by `complete()`. */
  unsignedTx: string;
  /** Builder body after `complete()`: fee and change output(s) included. */
  body: MeshTxBuilder["meshTxBuilderBody"];
  /** Transaction hash the signed transaction will have (body hash). */
  txHash: string;
  /** Fee in lovelace. */
  fee: string;
  /** Size of the unsigned transaction; witnesses add to this on signing. */
  sizeBytes: number;
  inputCount: number;
  outputCount: number;
};

export type BuildDraftTxOptions = {
  /** CIP-20 message written under metadata label 674. */
  metadataMessage?: string;
  /**
   * Finalizes the builder (fee, balancing, change) and returns the unsigned
   * tx hex. Injected so callers pick the production `complete` (with fresh
   * cost models) while tests avoid the network entirely.
   */
  complete: (txBuilder: MeshTxBuilder) => Promise<string>;
};

/**
 * Builds a draft into an unsigned transaction without signing, submitting or
 * persisting anything: the shared pipeline behind both the builder's "Build"
 * (test) button and the propose flow, up to the point where they diverge.
 *
 * The builder must be a fresh instance — `MeshTxBuilder` is stateful and a
 * completed builder cannot be reused for another build.
 */
export async function buildDraftTx(
  txBuilder: MeshTxBuilder,
  draft: TxDraft,
  ctx: ApplyDraftContext,
  opts: BuildDraftTxOptions,
): Promise<DraftBuildResult> {
  applyDraftToTxBuilder(txBuilder, draft, ctx);
  applyMetadataMessage(txBuilder, "674", opts.metadataMessage);

  const unsignedTx = await opts.complete(txBuilder);
  const body = txBuilder.meshTxBuilderBody;

  return {
    unsignedTx,
    body,
    txHash: resolveTxHash(unsignedTx).toLowerCase(),
    fee: String(body.fee ?? "0"),
    sizeBytes: Math.ceil(unsignedTx.length / 2),
    inputCount: body.inputs.length,
    outputCount: body.outputs.length,
  };
}
