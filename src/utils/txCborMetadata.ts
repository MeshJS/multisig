import { csl } from "@meshsdk/core-csl";

/**
 * Recovers the CIP-20 (label 674) message from a signed transaction's CBOR.
 *
 * The message can't be read from the stored `txJson`: MeshTxBuilder keeps
 * metadata in a Map, which `JSON.stringify` serializes to `{}`. The CBOR is
 * the only faithful source. Messages longer than 63 chars are stored as an
 * array of chunks (see `newTransaction` in `@/hooks/useTransaction`) — this
 * joins them back together.
 *
 * Returns `undefined` on any failure; callers treat a missing message as "no
 * metadata" rather than an error.
 */
export function extractTxMetadataMessage(txCbor: string): string | undefined {
  try {
    const metadata = csl.Transaction.from_hex(txCbor)
      .auxiliary_data()
      ?.metadata();
    const metadatum = metadata?.get(csl.BigNum.from_str("674"));
    if (!metadatum) return undefined;
    const decoded: unknown = JSON.parse(
      csl.decode_metadatum_to_json_str(
        metadatum,
        csl.MetadataJsonSchema.BasicConversions,
      ),
    );
    const msg = (decoded as { msg?: unknown } | null)?.msg;
    if (typeof msg === "string") return msg;
    if (Array.isArray(msg) && msg.every((part) => typeof part === "string")) {
      return msg.join("");
    }
    return undefined;
  } catch {
    return undefined;
  }
}
