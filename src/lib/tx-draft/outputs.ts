import type { MeshTxBuilder } from "@meshsdk/core";
import { z } from "zod";

import type { DraftPlutusData, TxDraft } from "@/types/tx-draft";
import { validatePlutusData } from "./plutus-data";

type Output = MeshTxBuilder["meshTxBuilderBody"]["outputs"][number];

function tokenAmounts(assets: Output["amount"]): string {
  const totals = new Map<string, bigint>();
  for (const asset of assets) {
    if (asset.unit === "lovelace") continue;
    totals.set(
      asset.unit,
      (totals.get(asset.unit) ?? 0n) + BigInt(asset.quantity),
    );
  }
  return JSON.stringify(
    [...totals]
      .filter(([, value]) => value !== 0n)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([unit, value]) => [unit, value.toString()]),
  );
}

/** Only forms we can reconstruct without discarding datum semantics. */
export function readInlineDatum(datum: unknown): DraftPlutusData | undefined {
  if (datum === undefined) return undefined;
  const shape = z
    .object({
      type: z.literal("Inline"),
      data: z
        .object({ type: z.enum(["CBOR", "JSON"]), content: z.unknown() })
        .strict(),
    })
    .strict()
    .parse(datum);
  const text =
    shape.data.type === "JSON" && typeof shape.data.content !== "string"
      ? JSON.stringify(shape.data.content)
      : shape.data.content;
  const parsed = validatePlutusData({ format: shape.data.type, text });
  if (!parsed.valid) throw new Error(parsed.error);
  return { format: "CBOR", text: parsed.cbor };
}

function fingerprint(output: Output): string {
  return JSON.stringify({
    address: output.address,
    amount: [...output.amount].sort((a, b) => a.unit.localeCompare(b.unit)),
    datum: readInlineDatum(output.datum)?.text,
    referenceScript: output.referenceScript,
  });
}

export type OutputReview = {
  id: string;
  address: string;
  requestedLovelace: string;
  actualLovelace: string;
  inlineDatum?: string;
};

/** Compare draft intent with the completed outputs, including SDK ADA top-ups. */
export function reviewDraftOutputs(
  draft: TxDraft,
  outputs: Output[],
): OutputReview[] {
  return draft.outputs.map((output, index) => {
    const actual = outputs[index];
    const datum =
      output.inlineDatum === undefined
        ? undefined
        : validatePlutusData(output.inlineDatum);
    if (datum && !datum.valid) throw new Error(datum.error);
    if (
      !actual ||
      actual.address !== output.address ||
      readInlineDatum(actual.datum)?.text !==
        (datum?.valid ? datum.cbor : undefined)
    ) {
      throw new Error(
        "Completed outputs no longer match the draft. Build and review again.",
      );
    }
    const requestedLovelace =
      output.assets.find((a) => a.unit === "lovelace")?.quantity ?? "0";
    const actualLovelace =
      actual.amount.find((a) => a.unit === "lovelace")?.quantity ?? "0";
    if (
      BigInt(actualLovelace) < BigInt(requestedLovelace) ||
      tokenAmounts(actual.amount) !== tokenAmounts(output.assets)
    ) {
      throw new Error(
        "Completed output assets no longer match the draft. Build and review again.",
      );
    }
    return {
      id: output.id,
      address: actual.address,
      requestedLovelace,
      actualLovelace,
      inlineDatum: datum?.valid ? datum.cbor : undefined,
    };
  });
}

/** Off-chain provenance is recorded after completion, so ADA adjustments match. */
export function createOutputProvenance(draft: TxDraft, outputs: Output[]) {
  reviewDraftOutputs(draft, outputs);
  return {
    version: 1 as const,
    outputs: draft.outputs.map((output, index) => ({
      id: output.id,
      fingerprint: fingerprint(outputs[index]!),
    })),
  };
}

/** A bad/legacy provenance record never authorizes stripping an output. */
export function readOutputProvenance(
  value: unknown,
  outputs: Output[],
  changeAddress: string,
): string[] | undefined {
  const parsed = z
    .object({
      version: z.literal(1),
      outputs: z.array(
        z
          .object({
            id: z
              .string()
              .min(1)
              .max(128)
              .regex(/^[a-zA-Z0-9_-]+$/),
            fingerprint: z.string(),
          })
          .strict(),
      ),
    })
    .strict()
    .safeParse(value);
  if (!parsed.success) return undefined;
  const entries = parsed.data.outputs;
  if (
    entries.length > outputs.length ||
    new Set(entries.map((entry) => entry.id)).size !== entries.length
  )
    return undefined;
  try {
    if (
      entries.some(
        (entry, index) => entry.fingerprint !== fingerprint(outputs[index]!),
      )
    )
      return undefined;
    if (
      outputs
        .slice(entries.length)
        .some(
          (output) =>
            !changeAddress ||
            output.address !== changeAddress ||
            output.datum !== undefined ||
            output.referenceScript !== undefined,
        )
    )
      return undefined;
    return entries.map((entry) => entry.id);
  } catch {
    return undefined;
  }
}
