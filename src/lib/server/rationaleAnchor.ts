/**
 * Governance vote rationale anchors (CIP-100 / CIP-136 shaped).
 *
 * A rationale becomes an anchor in three steps: build the JSON-LD document,
 * serialize it, hash the serialization. The serialization is the subtle part.
 *
 * `hashDrepAnchor` from @meshsdk/core is **not** a JSON-LD canonicalisation — it
 * is blake2b-256 over `JSON.stringify(doc, null, 2)`, verified empirically:
 * reordering keys changes the hash, and the digest matches the two-space pretty
 * form rather than the minified one. So the bytes pinned to IPFS must be that
 * exact pretty form, or a verifier fetching the URL and re-hashing gets a
 * different digest than the one recorded on-chain.
 *
 * `serializeRationale` is therefore the single place that decides those bytes,
 * and both the pin and the hash go through it.
 */

/** Plain text, per CIP-136. */
const MAX_SUMMARY_LENGTH = 300;

export type RationaleInput = {
  /** Short stance + reason. Truncated to 300 chars. */
  summary: string;
  /** The full argument. Markdown allowed. */
  rationaleStatement: string;
  /** Optional CIP-136 long-text fields. */
  precedentDiscussion?: string;
  counterargumentDiscussion?: string;
  conclusion?: string;
  /** Free-form references: label + uri pairs. */
  references?: { label: string; uri: string }[];
};

export type RationaleAnchor = {
  /** The JSON-LD document. */
  doc: Record<string, unknown>;
  /** The exact bytes to pin — hash this, pin this, nothing else. */
  json: string;
  /** blake2b-256 of `json`, as recorded on-chain. */
  hash: string;
  /** Suggested filename for the pin. */
  filename: string;
};

/**
 * CIP-100 base vocabulary plus the CIP-136 vote-rationale body terms.
 * Mirrors the context shape already used for DRep metadata in
 * `src/components/pages/wallet/governance/drep/drepMetadata.tsx`.
 */
const CONTEXT = {
  "@language": "en-us",
  CIP100:
    "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0100/README.md#",
  CIP136:
    "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0136/README.md#",
  hashAlgorithm: "CIP100:hashAlgorithm",
  body: {
    "@id": "CIP136:body",
    "@context": {
      references: {
        "@id": "CIP100:references",
        "@container": "@set",
        "@context": {
          GovernanceMetadata: "CIP100:GovernanceMetadataReference",
          Other: "CIP100:OtherReference",
          label: "CIP100:reference-label",
          uri: "CIP100:reference-uri",
        },
      },
      summary: "CIP136:summary",
      rationaleStatement: "CIP136:rationaleStatement",
      precedentDiscussion: "CIP136:precedentDiscussion",
      counterargumentDiscussion: "CIP136:counterargumentDiscussion",
      conclusion: "CIP136:conclusion",
    },
  },
} as const;

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

export function buildRationaleDocument(
  input: RationaleInput,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: truncate(input.summary.trim(), MAX_SUMMARY_LENGTH),
    rationaleStatement: input.rationaleStatement.trim(),
  };

  // Only emit optional fields that carry content — an empty string is still a
  // key, and every key changes the hash.
  if (input.precedentDiscussion?.trim()) {
    body.precedentDiscussion = input.precedentDiscussion.trim();
  }
  if (input.counterargumentDiscussion?.trim()) {
    body.counterargumentDiscussion = input.counterargumentDiscussion.trim();
  }
  if (input.conclusion?.trim()) {
    body.conclusion = input.conclusion.trim();
  }
  const references = (input.references ?? []).filter(
    (r) => r.label?.trim() && r.uri?.trim(),
  );
  if (references.length > 0) {
    body.references = references.map((r) => ({
      "@type": "Other",
      label: r.label.trim(),
      uri: r.uri.trim(),
    }));
  }

  return {
    "@context": CONTEXT,
    hashAlgorithm: "blake2b-256",
    body,
  };
}

/**
 * The one place that turns a document into bytes.
 *
 * Two-space pretty JSON, because that is what `hashDrepAnchor` hashes. Keep the
 * pin and the hash reading from this same string.
 */
export function serializeRationale(doc: Record<string, unknown>): string {
  return JSON.stringify(doc, null, 2);
}

/** Build, serialize and hash in one step. `hashFn` is injected so callers can
 *  pass `hashDrepAnchor` without this module importing @meshsdk/core — that
 *  package pulls WASM, and this file is imported by the MCP tool registry. */
export function buildRationaleAnchor(
  input: RationaleInput,
  hashFn: (doc: Record<string, unknown>) => string,
  filenameHint: string,
): RationaleAnchor {
  const doc = buildRationaleDocument(input);
  const json = serializeRationale(doc);
  return {
    doc,
    json,
    hash: hashFn(doc),
    filename: `${filenameHint.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80)}.jsonld`,
  };
}
