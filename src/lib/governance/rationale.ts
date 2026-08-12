import { hashDrepAnchor } from "@meshsdk/core";

/**
 * CIP-100 vote-rationale document tooling for the transaction builder's
 * edit-vote flow.
 *
 * INVARIANT: the bytes pinned to IPFS are `JSON.stringify(doc, null, 2)` and
 * `hashDrepAnchor(doc)` hashes exactly that same 2-space serialization —
 * upload body and hash must never diverge, or the on-chain anchor hash won't
 * verify against the fetched document.
 */

/**
 * Builds the CIP-100 JSON-LD rationale document from a free-text comment.
 * The shape (context key order included — key order changes the serialized
 * bytes and therefore the hash) must stay identical to the ballot editor's
 * `constructJsonLdFromComment` in
 * `src/components/pages/wallet/governance/ballot/ballot.tsx`, where it is
 * duplicated inside a non-exported component; converge them later.
 */
export function buildRationaleJsonLd(comment: string): object {
  return {
    "@context": {
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
    },
    authors: [],
    body: {
      comment: comment.trim(),
    },
    hashAlgorithm: "blake2b-256",
  };
}

/**
 * Uploads a rationale document to IPFS (pinata proxy route) and returns the
 * anchor for the rebuilt vote.
 */
export async function uploadRationale(
  comment: string,
): Promise<{ anchorUrl: string; anchorDataHash: string }> {
  const doc = buildRationaleJsonLd(comment);
  const response = await fetch("/api/pinata-storage/put", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pathname: `rationale/rationale-${Date.now()}.jsonld`,
      value: JSON.stringify(doc, null, 2),
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
  return { anchorUrl: res.url, anchorDataHash: hashDrepAnchor(doc) };
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
