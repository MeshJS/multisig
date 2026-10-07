import type { MeshTxBuilder, UTxO } from "@meshsdk/core";

import type { TxDraft } from "@/types/tx-draft";
import { materializeOutputAssets } from "./assets";
import { hasScriptSpendDraftData } from "./mutations";
import { PLUTUS_BUILD_UNSUPPORTED } from "./validate-plutus";
import { validatePlutusData } from "./plutus-data";
import { selectDraftFunding } from "./funding";
import { isPreparedPlutus, type PreparedPlutusDraft } from "./prepare-plutus";
import { applyCollateral } from "./collateral";

/**
 * How the source's inputs are witnessed: the multisig spends script inputs
 * (each `txIn` gets `txInScript`); a connected or arbitrary key-based wallet
 * spends plain pubkey inputs.
 */
export type ApplyDraftInputs =
  { kind: "script"; scriptCbor: string } | { kind: "pubkey" };

export type ApplyDraftContext = {
  /** Obtained only by the shared build pipeline's fresh chain resolver. */
  preparedPlutus?: PreparedPlutusDraft;
  inputs: ApplyDraftInputs;
  /** The source address: owner of the inputs and the change target. */
  walletAddress: string;
  /** Spendable UTxOs (pending-blocked ones excluded); used in auto mode. */
  availableUtxos: UTxO[];
  /** Wallet DRep id (CIP-129/105); required when the draft has votes. */
  drepId?: string;
  /** DRep native script CBOR; required when the draft has votes. */
  drepScriptCbor?: string;
  /** Wallet reward address; required when the draft has certificates. */
  stakeRewardAddress?: string;
  /** Staking native script CBOR; required when the draft has certificates. */
  stakeScriptCbor?: string;
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
  if (
    (hasScriptSpendDraftData(draft) || ctx.preparedPlutus) &&
    !isPreparedPlutus(draft, ctx.preparedPlutus)
  ) {
    throw new Error(PLUTUS_BUILD_UNSUPPORTED);
  }
  // Validate all datum edits before mutating the stateful builder.
  const datums = draft.outputs.map((output) => {
    if (output.inlineDatum === undefined) return undefined;
    const result = validatePlutusData(output.inlineDatum);
    if (!result.valid) throw new Error(`Output datum: ${result.error}`);
    return result.cbor;
  });
  const preparedOutputs = draft.outputs.map((output, index) => {
    const prepared: MeshTxBuilder["meshTxBuilderBody"]["outputs"][number] = {
      address: output.address,
      amount: [...materializeOutputAssets(output.assets)],
      ...(datums[index] !== undefined
        ? {
            datum: {
              type: "Inline" as const,
              data: { type: "CBOR" as const, content: datums[index]! },
            },
          }
        : {}),
    };
    if (prepared.datum) {
      const minimum = txBuilder.calculateMinLovelaceForOutput(prepared);
      const ada = prepared.amount.find((asset) => asset.unit === "lovelace");
      if (!ada)
        prepared.amount.push({
          unit: "lovelace",
          quantity: minimum.toString(),
        });
      else if (BigInt(ada.quantity) < minimum) {
        // materializeOutputAssets can retain asset objects from the draft.
        prepared.amount = prepared.amount.map((asset) =>
          asset.unit === "lovelace"
            ? { ...asset, quantity: minimum.toString() }
            : asset,
        );
      }
    }
    return prepared;
  });
  if (
    draft.outputs.length === 0 &&
    draft.votes.length === 0 &&
    draft.certificates.length === 0
  ) {
    throw new Error("Draft has no outputs, votes or certificates");
  }
  if (
    ctx.inputs.kind === "pubkey" &&
    (draft.votes.length > 0 || draft.certificates.length > 0)
  ) {
    throw new Error(
      "Staking certificates and votes can only be built from the multisig wallet",
    );
  }
  if (draft.votes.length > 0 && (!ctx.drepId || !ctx.drepScriptCbor)) {
    throw new Error("Draft has votes but no DRep context");
  }
  if (
    draft.certificates.length > 0 &&
    (!ctx.stakeRewardAddress || !ctx.stakeScriptCbor)
  ) {
    throw new Error("Draft has certificates but no staking context");
  }
  if (
    draft.certificates.some(
      (cert) => cert.kind === "DelegateStake" && !cert.poolId,
    )
  ) {
    throw new Error("Delegation certificate has no pool id");
  }

  const selectedUtxos = selectDraftFunding(
    {
      ...draft,
      outputs: draft.outputs.map((output, index) => ({
        ...output,
        assets: preparedOutputs[index]!.amount,
      })),
    },
    ctx.availableUtxos,
    ctx.preparedPlutus?.inputs.map((input) => input.utxo),
  );
  if (selectedUtxos.length === 0 && !ctx.preparedPlutus?.inputs.length) {
    throw new Error("Insufficient funds: no UTxOs selected");
  }

  if (
    ctx.preparedPlutus?.inputs.some(
      (input) => input.intent.script.version === "V1",
    ) &&
    selectedUtxos.some((utxo) => !!utxo.output.plutusData)
  )
    throw new Error(
      "Plutus V1 cannot be combined with inline datums on funding inputs.",
    );

  for (const utxo of selectedUtxos) {
    txBuilder.txIn(
      utxo.input.txHash,
      utxo.input.outputIndex,
      utxo.output.amount,
      utxo.output.address,
    );
    if (ctx.inputs.kind === "script") {
      txBuilder.txInScript(ctx.inputs.scriptCbor);
    }
  }

  for (const [index, output] of draft.outputs.entries()) {
    txBuilder.txOut(output.address, preparedOutputs[index]!.amount);
    if (datums[index] !== undefined) {
      txBuilder.txOutInlineDatumValue(datums[index]!, "CBOR");
    }
  }

  for (const { intent, utxo, datumCbor, redeemerCbor } of ctx.preparedPlutus
    ?.inputs ?? []) {
    txBuilder
      .spendingPlutusScript(intent.script.version)
      .txIn(
        utxo.input.txHash,
        utxo.input.outputIndex,
        utxo.output.amount,
        utxo.output.address,
        0,
      )
      .txInScript(intent.script.cbor);
    if (intent.datumSource.kind === "inline")
      txBuilder.txInInlineDatumPresent();
    else txBuilder.txInDatumValue(datumCbor, "CBOR");
    txBuilder.txInRedeemerValue(redeemerCbor, "CBOR");
  }
  if (ctx.preparedPlutus)
    applyCollateral(txBuilder, ctx.preparedPlutus.collateral);

  // Certificates are re-emitted against the wallet's freshly derived reward
  // address, not the loaded tx's stakeKeyAddress. Load order is preserved so
  // a register/delegate pair stays register-first. certificateScript is
  // applied PER CERT (like voteScript below); keep the calls in sync with
  // src/utils/stakingCertificates.ts, which the staking page uses.
  for (const cert of draft.certificates) {
    switch (cert.kind) {
      case "RegisterStake":
        txBuilder.registerStakeCertificate(ctx.stakeRewardAddress!);
        break;
      case "DelegateStake":
        txBuilder.delegateStakeCertificate(
          ctx.stakeRewardAddress!,
          cert.poolId!,
        );
        break;
      case "DeregisterStake":
        txBuilder.deregisterStakeCertificate(ctx.stakeRewardAddress!);
        break;
    }
    txBuilder.certificateScript(ctx.stakeScriptCbor!);
  }

  // Votes go before changeAddress (matching the governance pages' working
  // order). voteScript is applied PER VOTE so every vote serializes as
  // SimpleScriptVote — ballot-created txs only witnessed the last one.
  for (const vote of draft.votes) {
    txBuilder
      .vote(
        { type: "DRep", drepId: ctx.drepId! },
        { txHash: vote.govActionTxHash, txIndex: vote.govActionIndex },
        {
          voteKind: vote.voteKind,
          ...(vote.anchor
            ? {
                anchor: {
                  anchorUrl: vote.anchor.anchorUrl,
                  anchorDataHash: vote.anchor.anchorDataHash,
                },
              }
            : {}),
        },
      )
      .voteScript(ctx.drepScriptCbor!);
  }

  // Change always returns to the source wallet itself — a configurable
  // change address would let a draft quietly drain the wallet's remaining
  // funds to another address.
  txBuilder.changeAddress(ctx.walletAddress);

  return txBuilder;
}
