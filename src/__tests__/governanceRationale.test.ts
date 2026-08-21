import { hashDrepAnchor } from "@meshsdk/core";

import {
  buildRationaleJsonLd,
  findBallotRowForVote,
  uploadRationale,
} from "@/lib/governance/rationale";

/**
 * Expected CIP-100 document, copied verbatim from the ballot editor's
 * `constructJsonLdFromComment` (governance/ballot/ballot.tsx) — the shape
 * parity assertion, since that builder isn't exported.
 */
function expectedDoc(comment: string) {
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
    body: { comment },
    hashAlgorithm: "blake2b-256",
  };
}

describe("buildRationaleJsonLd", () => {
  test("matches the ballot editor's CIP-100 document shape, trimmed", () => {
    expect(buildRationaleJsonLd("  we support this  ")).toEqual(
      expectedDoc("we support this"),
    );
  });

  test("hash covers the exact 2-space serialization that gets pinned", () => {
    const doc = buildRationaleJsonLd("reasoning");
    const hash = hashDrepAnchor(doc as object);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // A round-trip through the pinned bytes re-hashes identically — proves
    // the uploaded document verifies against the attached anchorDataHash.
    const pinnedBytes = JSON.stringify(doc, null, 2);
    expect(hashDrepAnchor(JSON.parse(pinnedBytes) as object)).toBe(hash);
  });
});

describe("uploadRationale", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  test("pins the exact hashed serialization and returns the anchor", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    global.fetch = jest.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        json: async () => ({ url: "ipfs://newcid", cid: "newcid", id: "1" }),
      } as Response;
    }) as any;

    const anchor = await uploadRationale("  reasoning  ");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/pinata-storage/put");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.pathname).toMatch(/^rationale\/rationale-\d+\.jsonld$/);
    const doc = buildRationaleJsonLd("reasoning");
    expect(body.value).toBe(JSON.stringify(doc, null, 2));
    expect(anchor).toEqual({
      anchorUrl: "ipfs://newcid",
      anchorDataHash: hashDrepAnchor(doc as object),
    });
  });

  test("surfaces the API error message on failure", async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: "Pinata upload failed" }),
    })) as any;
    await expect(uploadRationale("text")).rejects.toThrow(
      /Rationale upload failed: Pinata upload failed/,
    );
  });

  test("rejects when the response has no URL", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as any;
    await expect(uploadRationale("text")).rejects.toThrow(/no URL returned/);
  });
});

describe("findBallotRowForVote", () => {
  const GOV_HASH = "a".repeat(64);
  const vote = {
    govActionTxHash: GOV_HASH,
    govActionIndex: 2,
    anchor: { anchorUrl: "ipfs://old", anchorDataHash: "b".repeat(64) },
  };

  test("matches by old anchor URL", () => {
    const ballots = [
      { id: "b1", items: ["x#0"], anchorUrls: ["", "ipfs://old"], anchorHashes: [] },
    ];
    expect(findBallotRowForVote(ballots, vote)).toEqual({
      ballotId: "b1",
      index: 1,
    });
  });

  test("matches by old anchor hash alone", () => {
    const ballots = [
      { id: "b1", anchorUrls: [], anchorHashes: ["b".repeat(64)] },
    ];
    expect(findBallotRowForVote(ballots, vote)).toEqual({
      ballotId: "b1",
      index: 0,
    });
  });

  test("empty-string ballot entries never match", () => {
    const ballots = [
      { id: "b1", items: [], anchorUrls: [""], anchorHashes: [""] },
    ];
    const anchorlessBallotVote = {
      ...vote,
      anchor: { anchorUrl: "", anchorDataHash: "" },
    };
    expect(
      findBallotRowForVote(ballots, anchorlessBallotVote),
    ).toBeUndefined();
  });

  test("anchor-less vote falls back to proposal id match", () => {
    const ballots = [
      { id: "b1", items: ["other#1"] },
      { id: "b2", items: ["skip#0", `${GOV_HASH}#2`] },
    ];
    expect(
      findBallotRowForVote(ballots, {
        govActionTxHash: GOV_HASH,
        govActionIndex: 2,
      }),
    ).toEqual({ ballotId: "b2", index: 1 });
  });

  test("first anchor match wins over later proposal-id matches", () => {
    const ballots = [
      { id: "b1", items: [`${GOV_HASH}#2`], anchorUrls: ["ipfs://old"] },
      { id: "b2", items: [`${GOV_HASH}#2`], anchorUrls: ["ipfs://old"] },
    ];
    expect(findBallotRowForVote(ballots, vote)).toEqual({
      ballotId: "b1",
      index: 0,
    });
  });

  test("no match returns undefined", () => {
    expect(
      findBallotRowForVote([], {
        govActionTxHash: GOV_HASH,
        govActionIndex: 0,
      }),
    ).toBeUndefined();
  });
});
