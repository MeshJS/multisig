/**
 * Serialisable shape of the vault trust view, shared by the build-time loader
 * and the browser.
 *
 * Kept apart from `@/lib/vault-trust` for the same reason `vault-types` is kept
 * apart from `vault`: that module reads the filesystem, so importing any *value*
 * from it into a client component would pull `fs` into the bundle and fail the
 * build.
 */

export type VaultTrustNote = {
  id: string;
  kind: "area" | "feature";
  /** The hub this note hangs under, for features. */
  area: string | null;
  state: string | null;
  owner: string | null;
  /** Body with frontmatter stripped. */
  body: string;
  /** `[[wikilinks]]` — the LOGICAL relation. May cycle; not part of any hash. */
  links: string[];
  /** This note's position in the trust commitment. */
  hash: string;
};

export type VaultTrustView = {
  /** Commitment over the hub hashes only — never their titles. */
  rootHash: string;
  /** Area notes, which act as proxy hubs. */
  hubs: string[];
  notes: VaultTrustNote[];
  /** Hub -> feature. The TRUST relation: downward, acyclic, hash-bearing. */
  trustEdges: { from: string; to: string }[];
  /** Features whose `area:` matches no hub — outside the commitment's spine. */
  orphans: string[];
};

/**
 * What a disclosure of `noteId` under its hub would reveal, and what it would
 * withhold. Derived in the browser from the view above so the UI can show the
 * consequence of drilling down, not just the content.
 */
export function disclosureFor(
  view: VaultTrustView,
  noteId: string,
): { path: string[]; withheld: string[] } | null {
  const note = view.notes.find((n) => n.id === noteId);
  if (!note) return null;

  // Everything the root commits to directly: the hubs, plus any feature whose
  // `area:` matched no hub and therefore hangs off the root on its own.
  const otherRoots = (keep: string) =>
    [...view.hubs, ...view.orphans].filter((id) => id !== keep);

  if (note.kind === "area") {
    // Disclosing a hub reveals the hub document and the HASHES of the documents
    // under it. Those children are withheld too — leaving them out made the
    // first thing every visitor sees under-report what a hub disclosure costs.
    const children = view.trustEdges
      .filter((e) => e.from === note.id)
      .map((e) => e.to);
    return { path: [note.id], withheld: [...children, ...otherRoots(note.id)] };
  }

  const edge = view.trustEdges.find((e) => e.to === noteId);
  if (!edge) {
    // An orphan is its own root: nothing sits between it and the commitment,
    // but every other root is still sealed. Reporting "nothing withheld" here
    // claimed a disclosure was free when it is not.
    return { path: [noteId], withheld: otherRoots(noteId) };
  }

  // Siblings under the same hub stay sealed: the disclosure carries their
  // hashes and nothing else.
  const siblings = view.trustEdges
    .filter((e) => e.from === edge.from && e.to !== noteId)
    .map((e) => e.to);

  return {
    path: [noteId, edge.from],
    withheld: [...siblings, ...otherRoots(edge.from)],
  };
}
