import { describe, expect, it } from "@jest/globals";

import { disclose, verifyDisclosure } from "@/lib/vault-proof/disclosure";
import {
  buildTrustGraph,
  newSalt,
  parseTrusts,
  type VaultDoc,
} from "@/lib/vault-proof/trust-graph";

/**
 * The two properties this construction exists for: a signature over the root is
 * binding on every document beneath it, and one document can be proved to belong
 * without revealing its siblings.
 */

function doc(
  id: string,
  content: string,
  trusts: readonly string[] = [],
): VaultDoc {
  // Fixed salt per id keeps the tests deterministic while still exercising the
  // salting path.
  return { id, salt: `salt-${id}`, content, trusts };
}

/** Banking and audit hubs sharing one child, under a blinded root. */
function vault(): VaultDoc[] {
  return [
    doc("Banking Hub", "# Banking\n\nsee [[Charter]]", [
      "Signer Set",
      "Spending Limits",
    ]),
    doc("Audit Hub", "# Audit", ["Spending Limits", "Controls"]),
    doc("Signer Set", "Alice, Bob, Carol. 2-of-3."),
    doc("Spending Limits", "Ceiling 50000 EUR. Expires 2026-12-31."),
    doc("Controls", "Quarterly review."),
  ];
}

function graphOf(docs: VaultDoc[]) {
  const built = buildTrustGraph(docs);
  if (!built.ok) throw new Error(built.errors.join("; "));
  return built.graph;
}

const asMap = (docs: VaultDoc[]) => new Map(docs.map((d) => [d.id, d]));

describe("buildTrustGraph", () => {
  it("builds a DAG and finds the hubs as roots", () => {
    const g = graphOf(vault());
    expect([...g.roots]).toEqual(["Audit Hub", "Banking Hub"]);
    expect(g.rootHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(graphOf(vault()).rootHash).toBe(graphOf(vault()).rootHash);
  });

  it("refuses a trust cycle and names the path", () => {
    const built = buildTrustGraph([
      doc("Charter", "c", ["Budget Policy"]),
      doc("Budget Policy", "b", ["Charter"]),
    ]);
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error("expected failure");
    expect(built.errors[0]).toMatch(/Trust cycle: /);
    expect(built.errors[0]).toMatch(/Charter/);
    expect(built.errors[0]).toMatch(/wikilink/);
  });

  it("names one cycle when another document also points into it", () => {
    // D also trusts B, so the walk reaches B again after the A->B->C->B cycle
    // has already failed. That second visit must neither look up a node that
    // was never built nor report a second, invented cycle.
    const built = buildTrustGraph([
      doc("A", "a", ["B"]),
      doc("B", "b", ["C"]),
      doc("C", "c", ["B"]),
      doc("D", "d", ["B"]),
    ]);
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error("expected failure");
    expect(built.errors.filter((e) => e.includes("Trust cycle"))).toHaveLength(
      1,
    );
  });

  it("refuses a trust edge to a document that does not exist", () => {
    const built = buildTrustGraph([doc("Hub", "h", ["Ghost"])]);
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error("expected failure");
    expect(built.errors[0]).toMatch(/trusts "Ghost", which does not exist/);
  });

  it("refuses duplicate ids rather than silently keeping one", () => {
    const built = buildTrustGraph([doc("A", "one"), doc("A", "two")]);
    expect(built.ok).toBe(false);
  });

  it("propagates a leaf edit all the way to the root", () => {
    const before = graphOf(vault()).rootHash;
    const edited = vault().map((d) =>
      d.id === "Spending Limits"
        ? doc(d.id, "Ceiling 900000 EUR.", d.trusts)
        : d,
    );
    expect(graphOf(edited).rootHash).not.toBe(before);
  });

  it("does not let a plain wikilink create a hash dependency", () => {
    // "Banking Hub" mentions [[Charter]] in its body but does not trust it.
    // Adding Charter as an untrusted document must not change the hub's hash —
    // that is what keeps the trust graph acyclic while the logical graph is not.
    const base = graphOf(vault());
    const withCharter = graphOf([
      ...vault(),
      doc("Charter", "unrelated prose"),
    ]);
    expect(withCharter.nodes.get("Banking Hub")!.hash).toBe(
      base.nodes.get("Banking Hub")!.hash,
    );
  });

  it("ignores the order trust edges are declared in", () => {
    const a = graphOf(vault()).nodes.get("Banking Hub")!.hash;
    const reordered = vault().map((d) =>
      d.id === "Banking Hub"
        ? doc(d.id, d.content, ["Spending Limits", "Signer Set"])
        : d,
    );
    expect(graphOf(reordered).nodes.get("Banking Hub")!.hash).toBe(a);
  });

  it("salts, so identical content does not produce identical hashes", () => {
    const g = graphOf([
      { id: "A", salt: newSalt(), content: "yes", trusts: [] },
      { id: "B", salt: newSalt(), content: "yes", trusts: [] },
    ]);
    expect(g.nodes.get("A")!.hash).not.toBe(g.nodes.get("B")!.hash);
  });

  it("binds a hub's identity — renaming it changes the commitment", () => {
    const renamed = vault().map((d) =>
      d.id === "Audit Hub"
        ? { ...d, id: "Q3 Restructuring Hub", salt: "salt-Audit Hub" }
        : d,
    );
    // Blinding means the root does not REVEAL titles — it is a hash over salted
    // hashes, so there is nothing to read out of it. It must NOT mean the root
    // is invariant to titles: that would let an honest disclosure be relabelled
    // and still verify. Identity is part of what is signed.
    expect(graphOf(renamed).rootHash).not.toBe(graphOf(vault()).rootHash);
  });

  it("does not let two vaults that differ only in names share a root", () => {
    const base = [
      doc("Alice", "signer weight 3"),
      doc("Bob", "signer weight 1"),
      doc("Signers", "# Signers", ["Alice", "Bob"]),
    ];
    // The same two documents with their names exchanged, each keeping the other
    // one's salt — so every (salt, content) pair in the vault is unchanged and
    // only the identities move. A commitment that ignores ids cannot tell these
    // apart, and a signature over the root would not say who holds weight 3.
    const swapped = [
      { ...doc("Bob", "signer weight 3"), salt: "salt-Alice" },
      { ...doc("Alice", "signer weight 1"), salt: "salt-Bob" },
      doc("Signers", "# Signers", ["Alice", "Bob"]),
    ];
    expect(graphOf(swapped).rootHash).not.toBe(graphOf(base).rootHash);
  });
});

describe("disclose and verify", () => {
  it("proves a document belongs, under the chosen hub", () => {
    const docs = vault();
    const g = graphOf(docs);
    const d = disclose(g, asMap(docs), "Spending Limits", "Banking Hub");
    expect(d.ok).toBe(true);
    if (!d.ok) throw new Error(d.error);

    expect(verifyDisclosure(d.disclosure, g.rootHash)).toEqual({
      ok: true,
      targetId: "Spending Limits",
      rootHash: g.rootHash,
    });
  });

  it("reveals the path and nothing else", () => {
    const docs = vault();
    const d = disclose(
      graphOf(docs),
      asMap(docs),
      "Spending Limits",
      "Banking Hub",
    );
    if (!d.ok) throw new Error(d.error);

    const revealed = d.disclosure.path.map((n) => n.id);
    expect(revealed).toEqual(["Spending Limits", "Banking Hub"]);

    // The withheld sibling contributes a hash and no content, no title.
    const hub = d.disclosure.path.find((n) => n.id === "Banking Hub")!;
    const withheld = hub.children.filter((c) => !c.disclosed);
    expect(withheld).toHaveLength(1);
    expect(Object.keys(withheld[0]!)).toEqual(["hash", "disclosed"]);

    const serialised = JSON.stringify(d.disclosure);
    expect(serialised).not.toContain("Alice, Bob, Carol");
    expect(serialised).not.toContain("Quarterly review");
    expect(serialised).not.toContain("Audit Hub");
  });

  it("leaks only a count of the other hubs", () => {
    const docs = vault();
    const d = disclose(graphOf(docs), asMap(docs), "Signer Set", "Banking Hub");
    if (!d.ok) throw new Error(d.error);
    expect(d.disclosure.siblingRootHashes).toHaveLength(1);
    expect(d.disclosure.siblingRootHashes[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a disclosure whose content was altered", () => {
    const docs = vault();
    const g = graphOf(docs);
    const d = disclose(g, asMap(docs), "Spending Limits", "Banking Hub");
    if (!d.ok) throw new Error(d.error);

    const tampered = {
      ...d.disclosure,
      path: d.disclosure.path.map((n) =>
        n.id === "Spending Limits"
          ? { ...n, content: "Ceiling 9000000 EUR." }
          : n,
      ),
    };
    const result = verifyDisclosure(tampered, g.rootHash);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/does not commit to the hash/);
  });

  it("refuses a disclosure whose documents have been relabelled", () => {
    const docs = vault();
    const g = graphOf(docs);
    const d = disclose(g, asMap(docs), "Signer Set", "Banking Hub");
    if (!d.ok) throw new Error(d.error);

    // Every byte stays honest; only the labels a relying party reads are
    // swapped. If ids are outside the commitment this verifies happily and the
    // verifier hands back an attacker-chosen targetId.
    const relabelled = {
      ...d.disclosure,
      targetId: "Spending Limits",
      path: d.disclosure.path.map((n, i) =>
        i === 0
          ? { ...n, id: "Spending Limits" }
          : { ...n, id: "Treasury Hub" },
      ),
    };

    expect(verifyDisclosure(relabelled, g.rootHash).ok).toBe(false);
  });

  it("rejects a disclosure checked against the wrong root", () => {
    const docs = vault();
    const d = disclose(graphOf(docs), asMap(docs), "Controls", "Audit Hub");
    if (!d.ok) throw new Error(d.error);
    expect(verifyDisclosure(d.disclosure, "0".repeat(64)).ok).toBe(false);
  });

  it("rejects a swapped sibling hash", () => {
    const docs = vault();
    const g = graphOf(docs);
    const d = disclose(g, asMap(docs), "Spending Limits", "Banking Hub");
    if (!d.ok) throw new Error(d.error);

    const tampered = {
      ...d.disclosure,
      path: d.disclosure.path.map((n) =>
        n.id === "Banking Hub"
          ? {
              ...n,
              children: n.children.map((c) =>
                c.disclosed ? c : { ...c, hash: "f".repeat(64) },
              ),
            }
          : n,
      ),
    };
    expect(verifyDisclosure(tampered, g.rootHash).ok).toBe(false);
  });

  it("serves a document that sits under two hubs, from either", () => {
    const docs = vault();
    const g = graphOf(docs);
    for (const hub of ["Banking Hub", "Audit Hub"]) {
      const d = disclose(g, asMap(docs), "Spending Limits", hub);
      expect(d.ok).toBe(true);
      if (!d.ok) throw new Error(d.error);
      expect(verifyDisclosure(d.disclosure, g.rootHash).ok).toBe(true);
    }
  });

  it("refuses to disclose under a hub that cannot reach the target", () => {
    const docs = vault();
    const d = disclose(graphOf(docs), asMap(docs), "Controls", "Banking Hub");
    expect(d.ok).toBe(false);
    if (d.ok) throw new Error("expected failure");
    expect(d.error).toMatch(/not reachable/);
  });
});

describe("parseTrusts", () => {
  it("accepts a list, a single value and wikilink brackets", () => {
    expect(parseTrusts({ trusts: ["A", "B"] })).toEqual(["A", "B"]);
    expect(parseTrusts({ trusts: "A" })).toEqual(["A"]);
    expect(parseTrusts({ trusts: ["[[A]]", " B "] })).toEqual(["A", "B"]);
  });

  it("returns nothing when no trust edges are declared", () => {
    expect(parseTrusts({})).toEqual([]);
    expect(parseTrusts({ area: "Governance" })).toEqual([]);
  });
});
