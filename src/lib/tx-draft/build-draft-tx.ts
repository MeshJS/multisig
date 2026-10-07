import type { MeshTxBuilder } from "@meshsdk/core";
import { resolveTxHash } from "@meshsdk/core-cst";

import type { TxDraft } from "@/types/tx-draft";
import { applyMetadataMessage } from "./metadata";
import { applyDraftToTxBuilder, type ApplyDraftContext } from "./to-tx-builder";
import { reviewDraftOutputs, type OutputReview } from "./outputs";
import {
  prepareDraftPlutus,
  type PlutusBuildOptions,
  type PreparedPlutusDraft,
} from "./prepare-plutus";
import {
  checkedEvaluator,
  checkEvaluation,
  checkPlutusLimits,
  type ScriptBudgetReview,
} from "./evaluate-plutus";
import { reviewCompletedCollateral } from "./collateral";
import { PLUTUS_BUILD_UNSUPPORTED } from "./validate-plutus";
import { hasScriptSpendDraftData } from "./mutations";

export type PlutusBuildReview = {
  inputs: PreparedPlutusDraft["inputs"];
  budgets: ScriptBudgetReview[];
  collateral: Awaited<ReturnType<typeof reviewCompletedCollateral>>;
};

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
  /** Intended outputs after SDK balancing/minimum-ADA adjustments. */
  outputReview?: OutputReview[];
  plutusReview?: PlutusBuildReview;
};

export type BuildDraftTxOptions = {
  /** CIP-20 message written under metadata label 674. */
  metadataMessage?: string;
  /** Connected-wallet capability; deliberately absent from headless callers. */
  plutus?: PlutusBuildOptions;
  isCurrent?: () => boolean;
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
  const isCurrent = opts.isCurrent ?? (() => true);
  const assertCurrent = () => {
    if (!isCurrent())
      throw new Error("Build superseded by a draft or environment change.");
  };
  assertCurrent();
  const advanced = hasScriptSpendDraftData(draft);
  if (advanced && !opts.plutus) throw new Error(PLUTUS_BUILD_UNSUPPORTED);
  const evaluator = txBuilder.evaluator;
  if (advanced && !evaluator)
    throw new Error(
      "Plutus builds require an available transaction evaluator.",
    );
  // Never reuse preparations or the editor's resolved snapshots across builds.
  const prepared = advanced
    ? await prepareDraftPlutus(draft, opts.plutus!, isCurrent)
    : undefined;
  let evaluatedDuringCompletion = false;
  if (prepared) {
    txBuilder.protocolParams(prepared.protocol);
    const checked = checkedEvaluator(evaluator!, isCurrent);
    txBuilder.evaluator = {
      evaluateTx: async (...args) => {
        const result = await checked.evaluateTx(...args);
        evaluatedDuringCompletion = true;
        return result;
      },
    };
  }
  try {
    assertCurrent();
    applyDraftToTxBuilder(txBuilder, draft, {
      ...ctx,
      preparedPlutus: prepared,
    });
    applyMetadataMessage(txBuilder, "674", opts.metadataMessage);
    const unsignedTx = await opts.complete(txBuilder);
    assertCurrent();
    let plutusReview: PlutusBuildReview | undefined;
    if (prepared) {
      if (!evaluatedDuringCompletion)
        throw new Error(
          "Transaction completion skipped script evaluation. Rebuild with an available evaluator.",
        );
      // Re-evaluate the exact cost-model-corrected bytes that will be reviewed
      // and signed. Mesh alone assigns indexes, integrates budgets and balances.
      const actions = await txBuilder.evaluator!.evaluateTx(unsignedTx);
      const budgets = checkEvaluation(unsignedTx, actions, true);
      const protocol = await opts.plutus!.provider.fetchProtocolParameters();
      assertCurrent();
      txBuilder.protocolParams(protocol);
      const signedSize =
        Math.max(unsignedTx.length, txBuilder.serializeMockTx().length) / 2;
      checkPlutusLimits(unsignedTx, signedSize, budgets, protocol);
      const collateral = await reviewCompletedCollateral(
        unsignedTx,
        prepared.collateral,
        {
          fetchProtocolParameters: async () => protocol,
        },
        isCurrent,
      );
      if (
        BigInt(collateral.fee) <
        txBuilder.calculateFeeForSerializedTx(signedSize)
      ) {
        throw new Error(
          "The final transaction fee is insufficient for the current parameters. Rebuild and review it again.",
        );
      }
      plutusReview = { inputs: prepared.inputs, budgets, collateral };
    }
    const body = structuredClone(txBuilder.meshTxBuilderBody);
    assertCurrent();
    return {
      unsignedTx,
      body,
      txHash: resolveTxHash(unsignedTx).toLowerCase(),
      fee: plutusReview?.collateral.fee ?? String(body.fee ?? "0"),
      sizeBytes: Math.ceil(unsignedTx.length / 2),
      inputCount: body.inputs.length,
      outputCount: body.outputs.length,
      outputReview: reviewDraftOutputs(draft, body.outputs),
      plutusReview,
    };
  } finally {
    txBuilder.evaluator = evaluator;
  }
}
