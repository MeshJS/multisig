import { keepRelevant, type MeshTxBuilder, type UTxO } from "@meshsdk/core";

import type { TxDraft } from "@/types/tx-draft";
import { materializeOutputAssets, requiredAssetTotals } from "./assets";

/**
 * Lovelace floor for auto UTxO selection when the draft casts votes or
 * carries staking certificates: such drafts can have no output totals, so
 * `keepRelevant` would select nothing and the fee would be unfundable.
 * Mirrors the governance vote button's fixed 5 ADA buffer.
 */
const ACTION_FEE_FLOOR_LOVELACE = 5_000_000n;

/**
 * Extra headroom per RegisterStake certificate: the 2 ADA stake key deposit
 * is paid from the inputs at `complete()` but appears in no output, so auto
 * selection has to be told about it explicitly.
 */
const STAKE_KEY_DEPOSIT_LOVELACE = 2_000_000n;

export type ApplyDraftContext = {
  /** The multisig payment script; every input is a script input. */
  scriptCbor: string;
  /** The multisig wallet address; default change target. */
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
    draft.outputs.length === 0 &&
    draft.votes.length === 0 &&
    draft.certificates.length === 0
  ) {
    throw new Error("Draft has no outputs, votes or certificates");
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

  let selectedUtxos: UTxO[];
  if (draft.utxoSelection.mode === "manual") {
    selectedUtxos = draft.utxoSelection.utxos;
  } else {
    const assetMap = new Map<string, string>();
    for (const [unit, quantity] of requiredAssetTotals(draft)) {
      assetMap.set(unit, quantity.toString());
    }
    if (draft.votes.length > 0 || draft.certificates.length > 0) {
      const registerCount = draft.certificates.filter(
        (cert) => cert.kind === "RegisterStake",
      ).length;
      const required =
        BigInt(assetMap.get("lovelace") ?? "0") +
        STAKE_KEY_DEPOSIT_LOVELACE * BigInt(registerCount);
      const floored =
        required < ACTION_FEE_FLOOR_LOVELACE
          ? ACTION_FEE_FLOOR_LOVELACE
          : required;
      assetMap.set("lovelace", floored.toString());
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

  // Change always returns to the multisig wallet itself — a configurable
  // change address would let a draft quietly drain the wallet's remaining
  // funds to another address.
  txBuilder.changeAddress(ctx.walletAddress);

  return txBuilder;
}
