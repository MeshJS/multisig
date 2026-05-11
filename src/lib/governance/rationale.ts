import { hashDrepAnchor } from "@meshsdk/core";

export type RationaleJsonLd = {
  "@context": Record<string, unknown>;
  authors: Array<{ name?: string }>;
  body: { comment: string };
  hashAlgorithm: "blake2b-256";
};

export type RationaleAnchor = {
  url: string;
  hash: string;
};

const CIP100_CONTEXT = {
  CIP100: "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0100/README.md#",
  hashAlgorithm: "CIP100:hashAlgorithm",
  body: {
    "@id": "CIP100:body",
    "@context": {
      references: {
        "@id": "CIP100:references",
        "@container": "@set",
        "@context": {
          GovernanceMetadata: "CIP100:GovernanceMetadataReference",
          Other: "CIP100:OtherReference",
          label: "CIP100:reference-label",
          uri: "CIP100:reference-uri",
          referenceHash: {
            "@id": "CIP100:referenceHash",
            "@context": {
              hashDigest: "CIP100:hashDigest",
              hashAlgorithm: "CIP100:hashAlgorithm",
            },
          },
        },
      },
      comment: "CIP100:comment",
      externalUpdates: {
        "@id": "CIP100:externalUpdates",
        "@context": {
          title: "CIP100:update-title",
          uri: "CIP100:uri",
        },
      },
    },
  },
  authors: {
    "@id": "CIP100:authors",
    "@container": "@set",
    "@context": {
      name: "http://xmlns.com/foaf/0.1/name",
      witness: {
        "@id": "CIP100:witness",
        "@context": {
          witnessAlgorithm: "CIP100:witnessAlgorithm",
          publicKey: "CIP100:publicKey",
          signature: "CIP100:signature",
        },
      },
    },
  },
} as const;

export function buildRationaleJsonLd(comment: string): RationaleJsonLd {
  return {
    "@context": CIP100_CONTEXT,
    authors: [],
    body: { comment: comment.trim() },
    hashAlgorithm: "blake2b-256",
  };
}

export function computeAnchorHash(jsonData: unknown): string {
  return hashDrepAnchor(jsonData as Record<string, unknown>);
}

export async function uploadRationaleToPinata(
  jsonLd: RationaleJsonLd | Record<string, unknown>,
): Promise<RationaleAnchor> {
  const payload = JSON.stringify(jsonLd, null, 2);
  const response = await fetch("/api/pinata-storage/put", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pathname: `rationale/rationale-${Date.now()}.jsonld`,
      value: payload,
    }),
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(err?.error ?? `Upload failed (${response.status})`);
  }
  const res = (await response.json()) as { url: string };
  const hash = computeAnchorHash(jsonLd);
  return { url: res.url, hash };
}

export async function loadRationaleFromUrl(url: string): Promise<{
  json: Record<string, unknown>;
  comment: string;
  hash: string;
}> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch rationale (${res.status})`);
  const data = (await res.json()) as Record<string, unknown>;
  const hash = computeAnchorHash(data);
  const body = (data?.body ?? {}) as { comment?: unknown };
  const comment = typeof body.comment === "string" ? body.comment : "";
  return { json: data, comment, hash };
}
