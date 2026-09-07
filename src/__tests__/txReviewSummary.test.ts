import { describe, expect, it } from "@jest/globals";

import { createServerAddressLabeler } from "@/lib/tx-review/labels";
import {
  formatReviewAmount,
  summarizeMeshBody,
  summaryToText,
} from "@/lib/tx-review/summary";

const WALLET = "addr_test1qpwallet";
const ALICE = "addr_test1qpalice";
const BOB = "addr_test1qpbob";
const STRANGER = "addr_test1qpstranger";
const HOSKY = `${"a".repeat(56)}484f534b59`;

const labelAddress = createServerAddressLabeler({
  walletAddress: WALLET,
  signersAddresses: [ALICE, BOB],
  signersDescriptions: ["Alice", ""],
  contacts: [{ address: STRANGER, name: "Landlord" }],
});

const assetMetadata = {
  [HOSKY]: { assetName: "HOSKY", ticker: "HOSKY", decimals: 0, image: "", policyId: "a".repeat(56) },
};

/** A completed builder body: payments first, change appended last. */
const body = {
  inputs: [
    { type: "Script", txIn: { txHash: "1".repeat(64), txIndex: 0, amount: [{ unit: "lovelace", quantity: "50000000" }], address: WALLET } },
    { type: "Script", txIn: { txHash: "2".repeat(64), txIndex: 1, amount: [{ unit: "lovelace", quantity: "3000000" }, { unit: HOSKY, quantity: "10" }], address: WALLET } },
  ],
  outputs: [
    { address: STRANGER, amount: [{ unit: "lovelace", quantity: "12500000" }] },
    { address: ALICE, amount: [{ unit: "lovelace", quantity: "1160000" }, { unit: HOSKY, quantity: "10" }] },
    { address: WALLET, amount: [{ unit: "lovelace", quantity: "39160000" }] },
  ],
  changeAddress: WALLET,
  fee: "180000",
  certificates: [
    { certType: { type: "RegisterStake", stakeKeyAddress: "stake_test1uqxyz" } },
    { certType: { type: "DelegateStake", stakeKeyAddress: "stake_test1uqxyz", poolId: "pool1abc" } },
  ],
  votes: [
    {
      vote: {
        govActionId: { txHash: "c".repeat(64), txIndex: 0 },
        votingProcedure: { voteKind: "Yes" },
      },
    },
  ],
  metadata: { "674": { msg: ["Rent for ", "September"] } },
};

function summarize(kind: "preview" | "pending" = "preview") {
  return summarizeMeshBody(body, {
    kind,
    wallet: { id: "w1", name: "Treasury", address: WALLET, network: 0 },
    threshold: { required: 2, total: 2, type: "atLeast" },
    signedAddresses: kind === "pending" ? [ALICE] : [],
    rejectedAddresses: [],
    description: "Rent + delegate",
    labelAddress,
    assetMetadata,
    resolvePoolName: (poolId) => (poolId === "pool1abc" ? "[MESH] Mesh Pool" : undefined),
    resolveProposalTitle: (id) => (id === `${"c".repeat(64)}#0` ? "Increase treasury cap" : undefined),
    pendingRationales: new Map([[`${"c".repeat(64)}#0`, "We support this because it is good."]]),
    txHash: "ab".repeat(32),
    sizeBytes: 1234,
    now: new Date("2026-09-07T12:00:00Z"),
  });
}

describe("formatReviewAmount", () => {
  it("writes ADA with exact decimals and thousands separators, never the ₳ glyph", () => {
    expect(formatReviewAmount({ unit: "lovelace", quantity: "1123456789" }, {}).display).toBe("1,123.456789 ADA");
    expect(formatReviewAmount({ unit: "lovelace", quantity: "1000000" }, {}).display).toBe("1 ADA");
  });

  it("uses the registered ticker and decimals for tokens", () => {
    const unit = `${"b".repeat(56)}00`;
    const meta = { [unit]: { assetName: "Token", ticker: "TKN", decimals: 2, image: "", policyId: "b".repeat(56) } };
    expect(formatReviewAmount({ unit, quantity: "12345" }, meta).display).toBe("123.45 TKN");
  });

  it("falls back to a truncated unit for unknown assets", () => {
    const unit = `${"b".repeat(56)}deadbeef`;
    expect(formatReviewAmount({ unit, quantity: "3" }, {}).display).toBe("3 bbbb…beef");
  });
});

describe("summarizeMeshBody", () => {
  it("separates payments from the trailing change output", () => {
    const summary = summarize();
    expect(summary.recipients.map((r) => r.address)).toEqual([STRANGER, ALICE]);
    expect(summary.change.map((a) => a.display)).toEqual(["39.16 ADA"]);
  });

  it("labels recipients from the wallet's own data", () => {
    const summary = summarize();
    expect(summary.recipients[0]).toMatchObject({ label: "Landlord", partyType: "contact" });
    expect(summary.recipients[1]).toMatchObject({ label: "Alice", partyType: "signer" });
    expect(summary.recipients[1]!.amounts.map((a) => a.display)).toEqual(["1.16 ADA", "10 HOSKY"]);
    // Unnamed signer gets a positional label rather than nothing.
    expect(labelAddress(BOB)).toEqual({ label: "Signer 2", type: "signer" });
    expect(labelAddress(WALLET)).toEqual({ label: "This wallet", type: "self" });
  });

  it("reports fee, inputs, and the stake deposit implied by registration", () => {
    const summary = summarize();
    expect(summary.fee?.display).toBe("0.18 ADA");
    expect(summary.inputs).toEqual({
      count: 2,
      total: [
        { unit: "lovelace", quantity: "53000000", display: "53 ADA" },
        { unit: HOSKY, quantity: "10", display: "10 HOSKY" },
      ],
      unresolved: 0,
    });
    expect(summary.deposit?.display).toBe("2 ADA");
  });

  it("describes certificates and votes with resolved names and rationale status", () => {
    const summary = summarize();
    expect(summary.actions).toEqual([
      expect.objectContaining({ kind: "certificate", label: "Stake Registration" }),
      expect.objectContaining({ kind: "certificate", label: "Stake Delegation", title: "[MESH] Mesh Pool" }),
      expect.objectContaining({
        kind: "vote",
        label: "Vote: Yes",
        title: "Increase treasury cap",
        rationale: { status: "will-publish-on-confirm", excerpt: "We support this because it is good." },
      }),
    ]);
  });

  it("reads the CIP-20 message and carries the wallet facts", () => {
    const summary = summarize();
    expect(summary.metadataMessage).toBe("Rent for September");
    expect(summary.wallet).toEqual({ id: "w1", name: "Treasury", address: WALLET, network: "preprod" });
    expect(summary.txHash).toBe("ab".repeat(32));
    expect(summary.sizeBytes).toBe(1234);
    expect(summary.generatedAt).toBe("2026-09-07T12:00:00.000Z");
  });

  it("counts remaining signatures for a pending transaction", () => {
    const summary = summarize("pending");
    expect(summary.signatures.signed).toEqual([{ address: ALICE, label: "Alice" }]);
    expect(summary.signatures.remaining).toBe(1);
  });

  it("keeps an anchored vote's URL", () => {
    const anchored = {
      ...body,
      votes: [
        {
          vote: {
            govActionId: { txHash: "c".repeat(64), txIndex: 0 },
            votingProcedure: { voteKind: "No", anchor: { anchorUrl: "ipfs://cid", anchorDataHash: "00" } },
          },
        },
      ],
    };
    const summary = summarizeMeshBody(anchored, {
      kind: "pending",
      wallet: { id: "w1", name: "Treasury", address: WALLET, network: 0 },
      threshold: { required: 2, total: 2, type: "atLeast" },
      signedAddresses: [],
      rejectedAddresses: [],
      description: "",
      labelAddress,
      assetMetadata,
      txHash: "00",
    });
    expect(summary.actions.find((a) => a.kind === "vote")?.rationale).toEqual({ status: "anchored", url: "ipfs://cid" });
  });

  it("degrades a malformed body instead of throwing", () => {
    const summary = summarizeMeshBody(
      { outputs: "nope", inputs: [{}], fee: "abc" },
      {
        kind: "preview",
        wallet: { id: "w1", name: "T", address: WALLET, network: 1 },
        threshold: { required: 1, total: 1, type: "all" },
        signedAddresses: [],
        rejectedAddresses: [],
        description: null,
        labelAddress,
        assetMetadata: {},
        txHash: "00",
      },
    );
    expect(summary.recipients).toEqual([]);
    expect(summary.fee).toBeNull();
    expect(summary.inputs.unresolved).toBe(1);
    expect(summary.wallet.network).toBe("mainnet");
  });
});

describe("summaryToText", () => {
  it("states the boundary and every fact a signer needs", () => {
    const text = summaryToText(summarize());
    expect(text).toContain("UNSIGNED PREVIEW — nothing has been saved, signed or broadcast.");
    expect(text).toContain("Landlord (addr_test1qp...ranger): 12.5 ADA");
    expect(text).toContain("Alice (addr_test1qp...palice): 1.16 ADA + 10 HOSKY");
    expect(text).toContain("Vote: Yes — Increase treasury cap");
    expect(text).toContain("rationale will be published to IPFS on confirm");
    expect(text).toContain("fee 0.18 ADA, deposit 2 ADA, change back to the wallet 39.16 ADA, 2 inputs.");
    expect(text).toContain('On-chain message: "Rent for September"');
    expect(text).toContain("transaction_propose");
  });

  it("reports signature progress for a pending transaction", () => {
    const text = summaryToText(summarize("pending"));
    expect(text).toContain("PENDING — 1 of 2 signatures collected, 1 still needed.");
    expect(text).not.toContain("transaction_propose");
  });
});
