import { csl } from "@meshsdk/core-csl";
import {
  fromBuilderToPlutusData,
  fromPlutusDataToJson,
} from "@meshsdk/core-cst";
import { z } from "zod";

const hexBytes = z
  .string()
  .regex(/^(?:[0-9a-fA-F]{2})*$/, "Expected whole hex bytes.");
const integer = z.union([
  z.number().int().safe(),
  z.string().regex(/^-?(?:0|[1-9]\d*)$/, "Expected a decimal integer string."),
]);

type PlutusJson =
  | { int: number | string }
  | { bytes: string }
  | { list: PlutusJson[] }
  | { map: { k: PlutusJson; v: PlutusJson }[] }
  | { constructor: number | string; fields: PlutusJson[] };

const plutusJson: z.ZodType<PlutusJson> = z.lazy(() =>
  z.union([
    z.object({ int: integer }).strict(),
    z.object({ bytes: hexBytes }).strict(),
    z.object({ list: z.array(plutusJson) }).strict(),
    z
      .object({
        map: z.array(z.object({ k: plutusJson, v: plutusJson }).strict()),
      })
      .strict(),
    z
      .object({
        constructor: integer.refine(
          (value) => BigInt(value) >= 0n,
          "Constructor must be non-negative.",
        ),
        fields: z.array(plutusJson),
      })
      .strict(),
  ]),
);

const entrySchema = z
  .object({
    format: z.enum(["CBOR", "JSON"]),
    text: z.string().trim().min(1, "Enter Plutus data."),
  })
  .strict();

export type PlutusDataResult =
  { valid: true; cbor: string; json: string } | { valid: false; error: string };

/**
 * Reject numeric tokens that JSON.parse could round. Quoted decimal integers
 * are lossless and supported by Mesh, including values beyond MAX_SAFE_INTEGER.
 * This only checks tokens; JSON.parse still owns syntax parsing.
 */
function parseJson(text: string): unknown {
  const tokens =
    text.match(/"(?:\\[\s\S]|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ??
    [];
  for (const token of tokens) {
    if (token.startsWith('"')) continue;
    if (!/^-?\d+$/.test(token) || !Number.isSafeInteger(Number(token))) {
      throw new Error(
        "Use whole safe integers, or quoted decimal integers for large values; decimals and exponents are not supported.",
      );
    }
  }
  return JSON.parse(text) as unknown;
}

/** Shared by inline datums, supplied input datums, and redeemers. No caching. */
export function validatePlutusData(entry: unknown): PlutusDataResult {
  const parsed = entrySchema.safeParse(entry);
  if (!parsed.success) {
    return {
      valid: false,
      error: parsed.error.issues[0]?.message ?? "Invalid Plutus data entry.",
    };
  }
  const { format, text } = parsed.data;
  try {
    let data: ReturnType<typeof fromBuilderToPlutusData>;
    if (format === "CBOR") {
      if (!hexBytes.safeParse(text).success) {
        return { valid: false, error: "CBOR must contain whole hex bytes." };
      }
      const content = text.toLowerCase();
      // SDK parsers accept a prefix followed by extra CBOR. Require a lossless
      // CSL round trip so trailing bytes / unsupported encodings cannot pass.
      if (csl.PlutusData.from_hex(content).to_hex() !== content) {
        return {
          valid: false,
          error:
            "CBOR must encode exactly one Plutus value in a lossless SDK-supported encoding.",
        };
      }
      data = fromBuilderToPlutusData({ type: "CBOR", content });
    } else {
      const json = plutusJson.safeParse(parseJson(text));
      if (!json.success) {
        return {
          valid: false,
          error:
            "Expected Plutus JSON: int, bytes, list, map, or constructor/fields, with no extra properties.",
        };
      }
      data = fromBuilderToPlutusData({ type: "JSON", content: json.data });
    }
    const cbor = data.toCbor();
    // Also check JSON-generated data against the ledger codec.
    csl.PlutusData.from_hex(cbor);
    return {
      valid: true,
      cbor,
      json: JSON.stringify(
        fromPlutusDataToJson(data),
        (_key, value: unknown) =>
          typeof value === "bigint" ? value.toString() : value,
        2,
      ),
    };
  } catch (error) {
    return {
      valid: false,
      error:
        error instanceof Error &&
        error.message.startsWith("Use whole safe integers")
          ? error.message
          : `Invalid ${format === "CBOR" ? "Plutus CBOR" : "Plutus JSON"}. Check the data structure and encoding.`,
    };
  }
}
