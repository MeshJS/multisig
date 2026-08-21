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

  if (note.kind === "area") {
    return { path: [note.id], withheld: view.hubs.filter((h) => h !== note.id) };
  }

  const edge = view.trustEdges.find((e) => e.to === noteId);
  if (!edge) return { path: [noteId], withheld: [] };

  // Siblings under the same hub stay sealed: the disclosure carries their
  // hashes and nothing else.
  const siblings = view.trustEdges
    .filter((e) => e.from === edge.from && e.to !== noteId)
    .map((e) => e.to);

  return {
    path: [noteId, edge.from],
    withheld: [...siblings, ...view.hubs.filter((h) => h !== edge.from)],
  };
}
