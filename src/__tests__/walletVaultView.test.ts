import { describe, expect, it, jest } from "@jest/globals";
import type { PrismaClient } from "@prisma/client";

import { buildWalletVaultView } from "@/lib/documents/vault-db";

/**
 * The wallet vault is derived, not authored, so the interesting cases are the
 * ones a user creates by accident: two documents with the same title, a
 * document named after its own type, a document with no type at all. Any of
 * those produces a duplicate node id, and `buildTrustGraph` refuses duplicates
 * — so without deliberate disambiguation the whole page would throw.
 */

type Doc = {
  id: string;
  title: string;
  description: string | null;
  documentType: string | null;
  status: string;
  createdBy: string;
  versions: { versionNumber: number; contentHash: string; status: string }[];
};

function fakeDb(documents: Doc[], vaultSalt: string | null = "ab".repeat(32)) {
  const update = jest.fn(async () => ({}));
  return {
    db: {
      wallet: {
        findUnique: jest.fn(async () => ({ vaultSalt })),
        update,
      },
      document: { findMany: jest.fn(async () => documents) },
    } as unknown as PrismaClient,
    update,
  };
}

const doc = (over: Partial<Doc> & { id: string; title: string }): Doc => ({
  description: null,
  documentType: "Policy",
  status: "Draft",
  createdBy: "addr_test1creator",
  versions: [
    { versionNumber: 1, contentHash: "a".repeat(64), status: "Draft" },
  ],
  ...over,
});

describe("buildWalletVaultView", () => {
  it("groups documents under their type and commits to a root", async () => {
    const { db } = fakeDb([
      doc({ id: "d1", title: "Spending Limits" }),
      doc({ id: "d2", title: "Signer Set", documentType: "Governance" }),
    ]);
    const view = await buildWalletVaultView(db, "w1");

    expect(view.rootHash).toMatch(/^[0-9a-f]{64}$/);
    expect(view.hubs.sort()).toEqual(["Governance", "Policy"]);
    expect(view.trustEdges).toEqual(
      expect.arrayContaining([
        { from: "Policy", to: "Spending Limits" },
        { from: "Governance", to: "Signer Set" },
      ]),
    );
    for (const note of view.notes) expect(note.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(view.orphans).toEqual([]);
  });

  it("puts documents with no type under Uncategorised", async () => {
    const { db } = fakeDb([
      doc({ id: "d1", title: "Loose", documentType: null }),
    ]);
    const view = await buildWalletVaultView(db, "w1");
    expect(view.hubs).toEqual(["Uncategorised"]);
    expect(view.trustEdges).toEqual([{ from: "Uncategorised", to: "Loose" }]);
  });

  it("survives two documents sharing a title", async () => {
    const { db } = fakeDb([
      doc({ id: "doc-aaaaaa", title: "Charter" }),
      doc({ id: "doc-bbbbbb", title: "Charter" }),
    ]);
    const view = await buildWalletVaultView(db, "w1");

    const ids = view.notes.filter((n) => n.kind === "feature").map((n) => n.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain("Charter");
  });

  it("survives a document named after its own type", async () => {
    const { db } = fakeDb([doc({ id: "doc-cccccc", title: "Policy" })]);
    const view = await buildWalletVaultView(db, "w1");

    // The hub keeps the plain name; the document is the one that moves.
    expect(view.hubs).toEqual(["Policy"]);
    const feature = view.notes.find((n) => n.kind === "feature")!;
    expect(feature.id).not.toBe("Policy");
    expect(view.trustEdges).toEqual([{ from: "Policy", to: feature.id }]);
  });

  it("generates a vault secret once, then reuses it", async () => {
    const missing = fakeDb([doc({ id: "d1", title: "A" })], null);
    await buildWalletVaultView(missing.db, "w1");
    expect(missing.update).toHaveBeenCalledTimes(1);

    const present = fakeDb([doc({ id: "d1", title: "A" })]);
    await buildWalletVaultView(present.db, "w1");
    expect(present.update).not.toHaveBeenCalled();
  });

  it("gives different wallets different hashes for identical documents", async () => {
    const a = await buildWalletVaultView(
      fakeDb([doc({ id: "d1", title: "A" })], "11".repeat(32)).db,
      "w1",
    );
    const b = await buildWalletVaultView(
      fakeDb([doc({ id: "d1", title: "A" })], "22".repeat(32)).db,
      "w2",
    );
    // Salts are HMAC'd from the wallet secret, so a guessed title reveals
    // nothing about another wallet's node.
    expect(a.rootHash).not.toBe(b.rootHash);
  });

  it("is deterministic for the same wallet and documents", async () => {
    const once = await buildWalletVaultView(
      fakeDb([doc({ id: "d1", title: "A" })]).db,
      "w1",
    );
    const twice = await buildWalletVaultView(
      fakeDb([doc({ id: "d1", title: "A" })]).db,
      "w1",
    );
    expect(once.rootHash).toBe(twice.rootHash);
  });

  it("changes the root when a document's content hash changes", async () => {
    const before = await buildWalletVaultView(
      fakeDb([doc({ id: "d1", title: "A" })]).db,
      "w1",
    );
    const after = await buildWalletVaultView(
      fakeDb([
        doc({
          id: "d1",
          title: "A",
          versions: [
            { versionNumber: 2, contentHash: "b".repeat(64), status: "Draft" },
          ],
        }),
      ]).db,
      "w1",
    );
    expect(after.rootHash).not.toBe(before.rootHash);
  });

  it("handles a document with no versions yet", async () => {
    const { db } = fakeDb([doc({ id: "d1", title: "Fresh", versions: [] })]);
    const view = await buildWalletVaultView(db, "w1");
    expect(view.notes.find((n) => n.id === "Fresh")?.body).toContain(
      "No versions yet",
    );
  });
});
