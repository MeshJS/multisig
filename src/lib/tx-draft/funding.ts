import { keepRelevant, type UTxO } from "@meshsdk/core";
import type { TxDraft } from "@/types/tx-draft";
import { requiredAssetTotals, utxoFunds } from "./assets";
import { utxoRefKey } from "./resolve-script-inputs";

/** Explicit spends and collateral can never enter the ordinary witness loop. */
export function ordinaryFundingUtxos(draft: TxDraft, utxos: UTxO[]): UTxO[] {
  const excluded = new Set(
    (draft.scriptInputs ?? []).map((input) => utxoRefKey(input.utxoRef)),
  );
  if (draft.collateral) excluded.add(utxoRefKey(draft.collateral.utxoRef));
  return utxos.filter((utxo) => {
    const key = utxoRefKey(utxo.input);
    if (excluded.has(key)) return false;
    excluded.add(key);
    return true;
  });
}

/** Script value is added exactly once, even if the provider also lists it as funding. */
export function draftFundingTotals(
  draft: TxDraft,
  funding: UTxO[],
  scripts: UTxO[],
) {
  const seen = new Set<string>();
  const explicit = new Set(
    (draft.scriptInputs ?? []).map((input) => utxoRefKey(input.utxoRef)),
  );
  const collateral = draft.collateral && utxoRefKey(draft.collateral.utxoRef);
  return utxoFunds([
    ...ordinaryFundingUtxos(draft, funding),
    ...scripts.filter((utxo) => {
      const key = utxoRefKey(utxo.input);
      if (!explicit.has(key) || seen.has(key) || key === collateral)
        return false;
      seen.add(key);
      return true;
    }),
  ]);
}

/** Keep manual refs exactly; multisig Plutus spends must also exercise the native policy. */
export function selectDraftFunding(
  draft: TxDraft,
  available: UTxO[],
  scripts: UTxO[] = [],
  walletInput?: { address: string; allowInlineDatum: boolean },
): UTxO[] {
  const candidates = ordinaryFundingUtxos(draft, available).filter(
    (utxo) =>
      !walletInput ||
      (utxo.output.address === walletInput.address &&
        (walletInput.allowInlineDatum || !utxo.output.plutusData)),
  );
  if (draft.utxoSelection.mode === "manual") {
    const selected = draft.utxoSelection.utxos;
    if (ordinaryFundingUtxos(draft, selected).length !== selected.length) {
      throw new Error(
        "Funding inputs overlap script inputs, collateral, or each other.",
      );
    }
    if (walletInput) {
      const availableByRef = new Map(
        candidates.map((utxo) => [utxoRefKey(utxo.input), utxo]),
      );
      if (
        !selected.length ||
        selected.some((utxo) => !availableByRef.has(utxoRefKey(utxo.input)))
      )
        throw new Error(
          "Select at least one available, unblocked multisig wallet input. Every manual funding input must belong to this wallet and be compatible with the script language.",
        );
      // Keep the exact chosen refs and order, using current available output data.
      return selected.map((utxo) =>
        availableByRef.get(utxoRefKey(utxo.input))!,
      );
    }
    return selected;
  }
  if (walletInput && !candidates.length)
    throw new Error(
      "This multisig Plutus transaction needs an available, unblocked wallet input to enforce its approval policy. Fund the multisig wallet or free an input reserved by another pending transaction. Plutus V1 also requires funding without inline datums.",
    );
  const required = requiredAssetTotals(draft);
  if (draft.votes.length || draft.certificates.length) {
    const deposits =
      BigInt(
        draft.certificates.filter((cert) => cert.kind === "RegisterStake")
          .length,
      ) * 2_000_000n;
    const ada = (required.get("lovelace") ?? 0n) + deposits;
    required.set("lovelace", ada < 5_000_000n ? 5_000_000n : ada);
  }
  // Preserve Mesh's existing 5 ADA selection headroom, accounting for script
  // ADA before selecting funding. This is fee headroom, not collateral policy.
  required.set("lovelace", (required.get("lovelace") ?? 0n) + 5_000_000n);
  const scriptFunds = draftFundingTotals(draft, [], scripts);
  const remainder = new Map<string, string>();
  for (const [unit, amount] of required) {
    const deficit = amount - (scriptFunds.get(unit) ?? 0n);
    if (deficit > 0n) remainder.set(unit, deficit.toString());
  }
  const selected = remainder.size
    ? keepRelevant(remainder, candidates, "0")
    : [];
  // Value sufficiency alone must not remove the multisig's signing role.
  if (walletInput && !selected.length) return [candidates[0]!];
  return selected;
}
