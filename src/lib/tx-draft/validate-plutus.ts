import { z } from "zod";

import type { TxDraft } from "@/types/tx-draft";
import type { DraftIssue } from "./validate";
import { hasScriptSpendDraftData } from "./mutations";
import { validatePlutusData } from "./plutus-data";

export const PLUTUS_BUILD_UNSUPPORTED =
  "Plutus builds require a connected collateral wallet, fresh chain resolution, and an evaluator. Headless Plutus encoding is not enabled.";

export const utxoRefSchema = z
  .object({
    txHash: z.string().regex(/^[0-9a-fA-F]{64}$/),
    outputIndex: z.number().int().min(0).max(65535),
  })
  .strict();

export const scriptSchema = z
  .object({
    version: z.enum(["V1", "V2", "V3"]),
    cbor: z.string().regex(/^(?:[0-9a-fA-F]{2})+$/),
  })
  .strict();

/** Local shape/data validation only; chain resolution and evaluation come later. */
export function validatePlutusDraft(
  draft: TxDraft,
  allowPlutus = false,
): DraftIssue[] {
  const issues: DraftIssue[] = [];
  for (const output of draft.outputs) {
    if (output.inlineDatum === undefined) continue;
    const result = validatePlutusData(output.inlineDatum);
    if (!result.valid) {
      issues.push({
        level: "error",
        code: "output-datum-invalid",
        outputId: output.id,
        field: "inlineDatum",
        message: `Output datum: ${result.error}`,
      });
    }
  }

  const seen = new Set<string>();
  for (const input of draft.scriptInputs ?? []) {
    const anchor = { inputId: input.id, inputRef: input.utxoRef };
    const refKey = (ref: typeof input.utxoRef) =>
      `${ref.txHash.toLowerCase()}#${ref.outputIndex}`;
    if (
      (draft.collateral &&
        refKey(draft.collateral.utxoRef) === refKey(input.utxoRef)) ||
      (draft.utxoSelection.mode === "manual" &&
        draft.utxoSelection.utxos.some(
          (utxo) => refKey(utxo.input) === refKey(input.utxoRef),
        ))
    ) {
      issues.push({
        ...anchor,
        level: "error",
        code: "script-input-overlap",
        field: "utxoRef",
        message:
          "A script input cannot also be funding or collateral. Remove the overlapping selection.",
      });
    }
    if (!utxoRefSchema.safeParse(input.utxoRef).success) {
      issues.push({
        ...anchor,
        level: "error",
        code: "script-input-ref-invalid",
        field: "utxoRef",
        message:
          "Script input needs a transaction hash and valid output index.",
      });
    } else {
      const ref = `${input.utxoRef.txHash.toLowerCase()}#${input.utxoRef.outputIndex}`;
      if (seen.has(ref)) {
        issues.push({
          ...anchor,
          level: "error",
          code: "script-input-duplicate",
          field: "utxoRef",
          message: "This UTxO is already selected as a script input.",
        });
      }
      seen.add(ref);
    }
    if (!scriptSchema.safeParse(input.script).success) {
      issues.push({
        ...anchor,
        level: "error",
        code: "script-input-script-invalid",
        field: "script",
        message:
          "Choose a Plutus version and enter the script as whole hex bytes.",
      });
    }
    if (input.datumSource.kind === "provided") {
      const datum = validatePlutusData(input.datumSource.data);
      if (!datum.valid) {
        issues.push({
          ...anchor,
          level: "error",
          code: "script-input-datum-invalid",
          field: "datumSource",
          message: `Input datum: ${datum.error}`,
        });
      }
    }
    const redeemer = validatePlutusData(input.redeemer);
    if (!redeemer.valid) {
      issues.push({
        ...anchor,
        level: "error",
        code: "script-input-redeemer-invalid",
        field: "redeemer",
        message: `Redeemer: ${redeemer.error}`,
      });
    }
  }
  if (
    draft.collateral &&
    draft.utxoSelection.mode === "manual" &&
    draft.utxoSelection.utxos.some(
      (utxo) =>
        utxo.input.txHash.toLowerCase() ===
          draft.collateral!.utxoRef.txHash.toLowerCase() &&
        utxo.input.outputIndex === draft.collateral!.utxoRef.outputIndex,
    )
  ) {
    issues.push({
      level: "error",
      code: "script-input-overlap",
      field: "collateral",
      message: "Collateral cannot also be a normal funding input.",
    });
  }
  if (
    draft.collateral !== undefined &&
    !utxoRefSchema.safeParse(draft.collateral.utxoRef).success
  ) {
    issues.push({
      level: "error",
      code: "collateral-ref-invalid",
      field: "collateral",
      message: "Collateral needs a transaction hash and valid output index.",
    });
  }
  if (
    allowPlutus &&
    (((draft.scriptInputs ?? []).length > 0 && !draft.collateral) ||
      (draft.collateral && !(draft.scriptInputs ?? []).length))
  ) {
    issues.push({
      level: "error",
      code: "collateral-unavailable",
      field: "collateral",
      message: (draft.scriptInputs ?? []).length
        ? "Select an existing collateral UTxO from the connected wallet."
        : "Remove collateral when no script inputs are configured.",
    });
  }
  // Existing headless callers remain explicitly unsupported.
  if (hasScriptSpendDraftData(draft) && !allowPlutus) {
    issues.push({
      level: "error",
      code: "plutus-build-unsupported",
      message: PLUTUS_BUILD_UNSUPPORTED,
    });
  }
  return issues;
}
