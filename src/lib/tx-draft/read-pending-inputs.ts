import { z } from "zod";
import type { DraftScriptInput, DraftUtxoRef } from "@/types/tx-draft";
import { readInlineDatum } from "./outputs";
import {
  requiredSignersSchema,
  scriptSchema,
  utxoRefSchema,
} from "./validate-plutus";

const txInSchema = z
  .object({
    txHash: z.string(),
    txIndex: z.number(),
    amount: z
      .array(z.object({ unit: z.string(), quantity: z.string() }).strict())
      .optional(),
    address: z.string().optional(),
    scriptSize: z.number().optional(),
  })
  .strict();

const inputSchema = z
  .object({
    type: z.enum(["PubKey", "SimpleScript", "Script"]),
    txIn: txInSchema,
    simpleScriptTxIn: z
      .object({
        scriptSource: z
          .object({ type: z.literal("Provided"), scriptCode: z.string() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    scriptTxIn: z.unknown().optional(),
  })
  .strict();

function ref(value: z.infer<typeof txInSchema>): DraftUtxoRef {
  return utxoRefSchema.parse({
    txHash: value.txHash.toLowerCase(),
    outputIndex: value.txIndex,
  });
}

function data(value: unknown) {
  return readInlineDatum({ type: "Inline", data: value })!;
}

/** Parse stored Mesh relationships, never positional ledger redeemer indexes.
 * Amounts, budgets and ownership here are not trusted build inputs. */
export function readPendingInputs(tx: Record<string, unknown>) {
  const inputs = z.array(inputSchema).parse(tx.inputs);
  const fundingRefs: { txHash: string; txIndex: number }[] = [];
  const scriptInputs: DraftScriptInput[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const utxoRef = ref(input.txIn);
    const key = `${utxoRef.txHash}#${utxoRef.outputIndex}`;
    if (seen.has(key)) throw new Error("Duplicate transaction input reference");
    seen.add(key);
    if (input.type !== "Script") {
      if (
        input.scriptTxIn !== undefined ||
        (input.type === "PubKey" && input.simpleScriptTxIn !== undefined)
      )
        throw new Error("Conflicting transaction input witness shapes");
      fundingRefs.push({
        txHash: utxoRef.txHash,
        txIndex: utxoRef.outputIndex,
      });
      continue;
    }
    if (input.simpleScriptTxIn !== undefined)
      throw new Error("Conflicting transaction input witness shapes");
    const spend = z
      .object({
        scriptSource: z
          .object({
            type: z.literal("Provided"),
            script: z
              .object({ code: z.string(), version: z.enum(["V1", "V2", "V3"]) })
              .strict(),
          })
          .strict(),
        datumSource: z.discriminatedUnion("type", [
          z
            .object({
              type: z.literal("Inline"),
              txHash: z.string(),
              txIndex: z.number(),
            })
            .strict(),
          z.object({ type: z.literal("Provided"), data: z.unknown() }).strict(),
        ]),
        redeemer: z
          .object({
            data: z.unknown(),
            // Execution results are discarded and recomputed on every rebuild.
            exUnits: z
              .object({ mem: z.number(), steps: z.number() })
              .strict()
              .optional(),
          })
          .strict(),
      })
      .strict()
      .safeParse(input.scriptTxIn);
    if (!spend.success)
      throw new Error(
        `Script input ${key} has an unsupported script, datum source or redeemer; only supplied V1/V2/V3 scripts with inline or supplied data can be edited`,
      );
    const { scriptSource, datumSource, redeemer } = spend.data;
    const script = scriptSchema.parse({
      version: scriptSource.script.version,
      cbor: scriptSource.script.code,
    });
    if (
      datumSource.type === "Inline" &&
      (datumSource.txHash.toLowerCase() !== utxoRef.txHash ||
        datumSource.txIndex !== utxoRef.outputIndex)
    )
      throw new Error(
        `Script input ${key} refers to another input's inline datum`,
      );
    if (script.version === "V1" && datumSource.type === "Inline")
      throw new Error("Plutus V1 requires a supplied hash-matching datum");
    scriptInputs.push({
      id: `script-${utxoRef.txHash}-${utxoRef.outputIndex}`,
      utxoRef,
      script,
      datumSource:
        datumSource.type === "Inline"
          ? { kind: "inline" }
          : { kind: "provided", data: data(datumSource.data) },
      redeemer: data(redeemer.data),
    });
  }
  const collaterals = z
    .array(z.object({ type: z.literal("PubKey"), txIn: txInSchema }).strict())
    .parse(tx.collaterals === undefined ? [] : tx.collaterals);
  if (
    collaterals.length > 1 ||
    (collaterals.length > 0 && !scriptInputs.length)
  )
    throw new Error(
      "Only one key-controlled collateral input with Plutus spending can be edited",
    );
  if (scriptInputs.length && collaterals.length !== 1)
    throw new Error("Plutus transaction is missing its collateral input");
  const collateral = collaterals[0]
    ? { utxoRef: ref(collaterals[0].txIn) }
    : undefined;
  if (
    collateral &&
    seen.has(`${collateral.utxoRef.txHash}#${collateral.utxoRef.outputIndex}`)
  )
    throw new Error("Collateral overlaps a spending input");
  const signers = requiredSignersSchema.safeParse(
    tx.requiredSignatures === undefined ? [] : tx.requiredSignatures,
  );
  if (!signers.success)
    throw new Error(
      "Required signers must be 28-byte payment-key hashes; this requirement cannot be edited",
    );
  return {
    scriptInputs,
    collateral,
    fundingRefs,
    requiredSigners: [...new Set(signers.data.map((key) => key.toLowerCase()))],
  };
}
