import { hashDrepAnchor } from "@meshsdk/core";

import { fetchIpfsJson } from "@/lib/ipfs";

/**
 * CIP-100 vote-rationale document tooling, shared by the ballot editor, the
 * standalone rationale editor and the transaction builder's edit-vote flow.
 *
 * INVARIANT: the bytes pinned to IPFS are `JSON.stringify(doc, null, 2)` and
 * `hashDrepAnchor(doc)` hashes exactly that same 2-space serialization —
 * upload body and hash must never diverge, or the on-chain anchor hash won't
 * verify against the fetched document.
 */

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

/**
 * The CIP-100 context block. Key order is part of the hashed bytes, so it must
 * stay identical to the ballot editor's `constructJsonLdFromComment` in
 * `src/components/pages/wallet/governance/ballot/ballot.tsx`, where it is
 * duplicated inside a non-exported component; converge them later.
 */
const CIP100_CONTEXT = {
  CIP100:
    "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0100/README.md#",
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

/**
 * Builds the CIP-100 JSON-LD rationale document from a free-text comment.
 */
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

/**
 * Pins an already-built rationale document to IPFS (pinata proxy route) and
 * returns the anchor. The hash is taken over the same document object that was
 * serialized into the request body — see the INVARIANT above.
 */
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
    let detail = `status ${response.status}`;
    try {
      const err = (await response.json()) as { error?: string };
      if (err?.error) detail = err.error;
    } catch {
      // keep the status detail
    }
    throw new Error(`Rationale upload failed: ${detail}`);
  }
  const res = (await response.json()) as { url?: string };
  if (!res.url) {
    throw new Error("Rationale upload failed: no URL returned");
  }
  return { url: res.url, hash: computeAnchorHash(jsonLd) };
}

/**
 * Builds a rationale document from a comment and uploads it, returning the
 * anchor in the shape the transaction builder threads into `txBuilder.vote()`.
 */
export async function uploadRationale(
  comment: string,
): Promise<{ anchorUrl: string; anchorDataHash: string }> {
  const { url, hash } = await uploadRationaleToPinata(
    buildRationaleJsonLd(comment),
  );
  return { anchorUrl: url, anchorDataHash: hash };
}

/**
 * Fetches a previously pinned rationale so the editor can reload it from an
 * anchor URL, returning the document, its comment and its recomputed hash.
 *
 * Goes through `fetchIpfsJson` rather than a bare `fetch`: the anchor URL is
 * attacker-controlled input (any co-signer can store one), so IPFS references
 * must take the server-side resolver proxy and plain URLs must be https.
 */
export async function loadRationaleFromUrl(url: string): Promise<{
  json: Record<string, unknown>;
  comment: string;
  hash: string;
}> {
  const data = await fetchIpfsJson<Record<string, unknown>>(url);
  const hash = computeAnchorHash(data);
  const body = (data?.body ?? {}) as { comment?: unknown };
  const comment = typeof body.comment === "string" ? body.comment : "";
  return { json: data, comment, hash };
}

/**
 * Locates the ballot row backing a vote so its cached anchor/rationale can
 * be synced after a rebuild. Ballot rows join to votes only by array index:
 * prefer a match on the vote's OLD anchor (url or hash), else fall back to
 * the proposal id (`items[i]`). First match wins.
 */
export function findBallotRowForVote(
  ballots: Array<{
    id: string;
    items?: string[];
    anchorUrls?: string[];
    anchorHashes?: string[];
  }>,
  vote: {
    govActionTxHash: string;
    govActionIndex: number;
    anchor?: { anchorUrl: string; anchorDataHash: string };
  },
): { ballotId: string; index: number } | undefined {
  const proposalId = `${vote.govActionTxHash}#${vote.govActionIndex}`;

  if (vote.anchor) {
    for (const ballot of ballots) {
      const urls = ballot.anchorUrls ?? [];
      const hashes = ballot.anchorHashes ?? [];
      const count = Math.max(urls.length, hashes.length);
      for (let index = 0; index < count; index++) {
        if (
          (!!urls[index] && urls[index] === vote.anchor.anchorUrl) ||
          (!!hashes[index] && hashes[index] === vote.anchor.anchorDataHash)
        ) {
          return { ballotId: ballot.id, index };
        }
      }
    }
  }

  for (const ballot of ballots) {
    const index = (ballot.items ?? []).indexOf(proposalId);
    if (index >= 0) return { ballotId: ballot.id, index };
  }
  return undefined;
}
