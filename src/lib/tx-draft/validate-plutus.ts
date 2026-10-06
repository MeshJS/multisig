import { z } from "zod";

import type { TxDraft } from "@/types/tx-draft";
import type { DraftIssue } from "./validate";
import { hasScriptSpendDraftData } from "./mutations";
import { validatePlutusData } from "./plutus-data";

export const PLUTUS_BUILD_UNSUPPORTED =
  "Plutus script inputs and collateral cannot be built yet. Transaction encoding is not enabled.";

const utxoRefSchema = z
  .object({
    txHash: z.string().regex(/^[0-9a-fA-F]{64}$/),
    outputIndex: z.number().int().min(0).max(65535),
  })
  .strict();

const scriptSchema = z
  .object({
    version: z.enum(["V1", "V2", "V3"]),
    cbor: z.string().regex(/^(?:[0-9a-fA-F]{2})+$/),
  })
  .strict();

/** Local shape/data validation only; chain resolution and evaluation come later. */
export function validatePlutusDraft(draft: TxDraft): DraftIssue[] {
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
  // Until subsequent phases encode these fields, even valid intent must not be
  // silently discarded by the old builder. No UI/headless caller can bypass it.
  if (hasScriptSpendDraftData(draft)) {
    issues.push({
      level: "error",
      code: "plutus-build-unsupported",
      message: PLUTUS_BUILD_UNSUPPORTED,
    });
  }
  return issues;
}
