import { describe, expect, it } from "@jest/globals";

import { buildVaultTrustView } from "@/lib/vault-trust";
import {
  disclosureFor,
  type VaultTrustView,
} from "@/lib/vault-trust-types";

/**
 * Guards the /vault route against the repo's own vault.
 *
 * `buildVaultTrustView` throws when the trust edges are not a DAG, and the page
 * calls it from getServerSideProps — so a bad `area:` in a Markdown file would
 * not fail the build, would not fail any existing test, and would surface as a
 * 500 on a public, sitemap-indexed page. Failing here instead makes it a
 * pre-merge error on the commit that caused it.
 */
describe("the repo's own vault", () => {
  const view = buildVaultTrustView();

  it("forms a trust DAG and commits to a root", () => {
    expect(view.rootHash).toMatch(/^[0-9a-f]{64}$/);
    expect(view.hubs.length).toBeGreaterThan(0);
    expect(view.notes.length).toBeGreaterThan(view.hubs.length);
  });

  it("lists only area notes as hubs, never orphaned features", () => {
    // A feature whose `area:` matches no hub has no parent either, so it lands
    // in the graph's roots. Presenting roots as hubs listed it twice and
    // inflated the hub count.
    const areaIds = new Set(
      view.notes.filter((n) => n.kind === "area").map((n) => n.id),
    );
    for (const hub of view.hubs) expect(areaIds.has(hub)).toBe(true);
    for (const orphan of view.orphans) expect(view.hubs).not.toContain(orphan);
  });

  it("gives every note a hash and every trust edge two real ends", () => {
    const ids = new Set(view.notes.map((n) => n.id));
    for (const note of view.notes) expect(note.hash).toMatch(/^[0-9a-f]{64}$/);
    for (const edge of view.trustEdges) {
      expect(ids.has(edge.from)).toBe(true);
      expect(ids.has(edge.to)).toBe(true);
    }
  });
});

/** A hub with two children, plus a second hub and a note outside the spine. */
function view(): VaultTrustView {
  const note = (id: string, kind: "area" | "feature", area: string | null) => ({
    id,
    kind,
    area,
    state: null,
    owner: null,
    body: id,
    links: [],
    hash: "0".repeat(64),
  });
  return {
    rootHash: "f".repeat(64),
    hubs: ["Banking", "Audit"],
    notes: [
      note("Banking", "area", null),
      note("Audit", "area", null),
      note("Signer Set", "feature", "Banking"),
      note("Spending Limits", "feature", "Banking"),
      note("Stray Note", "feature", "Nowhere"),
    ],
    trustEdges: [
      { from: "Banking", to: "Signer Set" },
      { from: "Banking", to: "Spending Limits" },
    ],
    orphans: ["Stray Note"],
  };
}

describe("disclosureFor", () => {
  it("withholds a hub's own children, not just the other hubs", () => {
    const d = disclosureFor(view(), "Banking")!;
    expect(d.path).toEqual(["Banking"]);
    // Disclosing a hub reveals the hub document and its children's HASHES. The
    // children are withheld, and omitting them under-reported what the first
    // thing every visitor sees actually costs.
    expect(d.withheld.sort()).toEqual(
      ["Audit", "Signer Set", "Spending Limits", "Stray Note"].sort(),
    );
  });

  it("withholds siblings and the other roots for a note under a hub", () => {
    const d = disclosureFor(view(), "Signer Set")!;
    expect(d.path).toEqual(["Signer Set", "Banking"]);
    expect(d.withheld.sort()).toEqual(
      ["Audit", "Spending Limits", "Stray Note"].sort(),
    );
  });

  it("does not claim a note outside the spine withholds nothing", () => {
    const d = disclosureFor(view(), "Stray Note")!;
    expect(d.path).toEqual(["Stray Note"]);
    // It is its own root, so nothing sits above it — but every other root is
    // still sealed, and reporting "nothing withheld" claimed the disclosure was
    // free when it is not.
    expect(d.withheld.sort()).toEqual(["Audit", "Banking"].sort());
  });

  it("returns nothing for an id that is not in the vault", () => {
    expect(disclosureFor(view(), "No Such Note")).toBeNull();
  });
});
