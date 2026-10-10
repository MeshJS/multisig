/**
 * Structural view of `MeshTxBuilder.metadataValue` — the builder's method
 * returns `this`, which a recording stub can't satisfy through `Pick`.
 */
export type MetadataBuilder = {
  metadataValue: (label: string, metadata: object) => unknown;
};

/**
 * Cardano metadata strings are capped at 64 bytes; the app has always split
 * the CIP-20 message at 63 characters to stay under it.
 */
const METADATA_CHUNK_LENGTH = 63;

/**
 * Splits a message into the string / string-list shape written under a
 * `{ msg }` metadata label. Exported for tests; callers use
 * `applyMetadataMessage`.
 */
export function chunkMetadataMessage(value: string): string | string[] {
  if (value.length <= METADATA_CHUNK_LENGTH) return value;
  return value.match(new RegExp(`.{1,${METADATA_CHUNK_LENGTH}}`, "g")) ?? [];
}

/**
 * Attaches a CIP-20 style `{ msg }` message under `label` (normally "674").
 * A missing or empty message leaves the builder untouched.
 *
 * Both the proposal flow and the builder's test build go through this, so
 * the transaction previewed by a test build is byte-identical (fee, size)
 * to the one that gets proposed.
 */
export function applyMetadataMessage(
  txBuilder: MetadataBuilder,
  label: string,
  value: string | undefined,
): void {
  if (!value) return;
  txBuilder.metadataValue(label, { msg: chunkMetadataMessage(value) });
}
