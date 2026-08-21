import { createHash, randomBytes } from "node:crypto";

/**
 * The trust graph over a Markdown vault.
 *
 * A vault carries two different relations that happen to be written with the
 * same brackets, and separating them is what makes the whole construction work:
 *
 *   LOGICAL - a `[[wikilink]]` in the body. Carries a name and nothing else, so
 *   it creates no hash dependency and may point anywhere, including back up.
 *   Cycles here are normal and harmless. Not tamper-evident.
 *
 *   TRUST - declared in frontmatter as `trusts: [Other Note]`. Carries the
 *   target's hash, so it creates a real dependency: a document's hash covers
 *   everything it trusts, transitively. These must form a DAG, and the build
 *   fails loudly if they do not.
 *
 * The repo's own vault already distinguishes frontmatter-declared edges from
 * body wikilinks for its roadmap graph, so this is an existing convention made
 * load-bearing rather than a new one.
 */

/** Domain separators, so a node hash can never be confused with a root hash. */
const NODE_DOMAIN = "mesh-vault-proof/node/v1";
const ROOT_DOMAIN = "mesh-vault-proof/root/v1";

export type VaultDoc = {
  /** Stable identifier - the note title, which is how trust edges name targets. */
  id: string;
  /**
   * Per-document nonce. Without it, a short low-entropy document's hash can be
   * brute-forced from a guessed title, which would defeat withholding it.
   */
  salt: string;
  /** The exact bytes under trust - frontmatter and body as authored. */
  content: string;
  /** Ids this document commits to. Must be acyclic across the vault. */
  trusts: readonly string[];
};

export type TrustNode = {
  id: string;
  hash: string;
  trusts: readonly string[];
  /** Depth from the deepest leaf, used only to make ordering deterministic. */
  height: number;
};

export type TrustGraph = {
  nodes: ReadonlyMap<string, TrustNode>;
  /** Ids with no parent - the vault's top level, usually the proxy hubs. */
  roots: readonly string[];
  /**
   * Commitment over the whole vault. Built from the root ids' hashes ONLY -
   * never their titles - so disclosing it reveals how many hubs exist and
   * nothing about what they are called.
   */
  rootHash: string;
};

export type BuildResult =
  | { ok: true; graph: TrustGraph }
  | { ok: false; errors: string[] };

/** A fresh 16-byte salt as lowercase hex. One per document, stored with it. */
export function newSalt(): string {
  return randomBytes(16).toString("hex");
}

function sha256(parts: readonly string[]): string {
  const h = createHash("sha256");
  // Length-prefix every part. Without it, ("ab","c") and ("a","bc") hash
  // identically and a document could be substituted for a pair of others.
  for (const part of parts) {
    h.update(String(Buffer.byteLength(part, "utf8")));
    h.update(" ");
    h.update(part, "utf8");
  }
  return h.digest("hex");
}

/**
 * The commitment over a set of top-level hashes.
 *
 * Exported because the verifier must recompute exactly this, and a second
 * implementation of it in the verifier is a bug waiting to happen the first time
 * either side changes.
 */
export function hashRoot(topLevelHashes: readonly string[]): string {
  return sha256([ROOT_DOMAIN, [...topLevelHashes].sort().join("")]);
}

/**
 * A document's hash covers its id, its salt, its exact bytes, and the hashes of
 * everything it trusts. Children are sorted by hash rather than by declaration
 * order so that reordering the frontmatter list does not change the commitment.
 *
 * The id is part of the hash because this library models identity BY id: trust
 * edges name their targets by id, and both Disclosure and VerifyResult hand ids
 * back to a relying party. Leaving it out let an honest disclosure be
 * relabelled — same bytes, different `targetId` — and still verify, and let two
 * vaults whose documents differ only in name share one root hash.
 *
 * This does not weaken the blinded root. Blinding means the root does not
 * REVEAL titles: it is a hash over salted node hashes, so there is nothing to
 * read out of it. It never meant the root should be invariant to titles, which
 * is precisely what made relabelling possible.
 */
export function hashNode(
  doc: VaultDoc,
  childHashes: readonly string[],
): string {
  return sha256([
    NODE_DOMAIN,
    doc.id,
    doc.salt,
    doc.content,
    [...childHashes].sort().join(""),
  ]);
}

/**
 * Builds the graph, or refuses.
 *
 * Refusal cases are deliberate and loud: a cycle among trust edges (named with
 * the offending path), a trust edge to a document that does not exist, and
 * duplicate ids. A partially-built graph is never returned - a commitment over
 * a vault the builder did not fully understand is worse than no commitment.
 */
export function buildTrustGraph(docs: readonly VaultDoc[]): BuildResult {
  const errors: string[] = [];
  const byId = new Map<string, VaultDoc>();

  for (const doc of docs) {
    if (byId.has(doc.id)) {
      errors.push(`Duplicate document id "${doc.id}"`);
      continue;
    }
    if (!doc.salt) errors.push(`Document "${doc.id}" has no salt`);
    byId.set(doc.id, doc);
  }

  for (const doc of byId.values()) {
    for (const target of doc.trusts) {
      if (!byId.has(target)) {
        errors.push(`"${doc.id}" trusts "${target}", which does not exist`);
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // Depth-first with an explicit path, so a cycle can be reported as the actual
  // chain a human has to go and break rather than as "a cycle was detected".
  const state = new Map<string, "visiting" | "done" | "failed">();
  const nodes = new Map<string, TrustNode>();
  const path: string[] = [];

  const visit = (id: string): number | null => {
    const seen = state.get(id);
    if (seen === "done") return nodes.get(id)!.height;
    // Already known-bad. Stay quiet: the cycle it belongs to has been reported
    // once, and re-reporting it from every other branch that reaches it buries
    // the real chain under invented ones.
    if (seen === "failed") return null;
    if (seen === "visiting") {
      const from = path.indexOf(id);
      errors.push(
        `Trust cycle: ${[...path.slice(from), id].join(" -> ")}. ` +
          `Trust edges must form a DAG - make one of these a plain [[wikilink]] instead.`,
      );
      return null;
    }

    state.set(id, "visiting");
    path.push(id);

    const doc = byId.get(id)!;
    const childHashes: string[] = [];
    let height = 0;
    for (const target of doc.trusts) {
      const childHeight = visit(target);
      if (childHeight === null) {
        // "failed", not "done": no node was built for this id, so a later
        // branch reaching it must not look one up. And not left as "visiting"
        // either, which would make every later branch report it as a fresh
        // cycle.
        path.pop();
        state.set(id, "failed");
        return null;
      }
      childHashes.push(nodes.get(target)!.hash);
      height = Math.max(height, childHeight + 1);
    }

    path.pop();
    state.set(id, "done");
    nodes.set(id, {
      id,
      hash: hashNode(doc, childHashes),
      trusts: doc.trusts,
      height,
    });
    return height;
  };

  for (const id of byId.keys()) {
    if (state.get(id) !== "done") visit(id);
  }
  if (errors.length > 0) return { ok: false, errors };

  const trusted = new Set<string>();
  for (const doc of byId.values()) for (const t of doc.trusts) trusted.add(t);
  const roots = [...byId.keys()].filter((id) => !trusted.has(id)).sort();

  // Blinded: the root commits to its children's HASHES, never their ids. Without
  // this the disclosure leak simply moves up a level, and revealing the root to
  // prove one facet would name every other facet.
  const rootHash = hashRoot(roots.map((id) => nodes.get(id)!.hash));

  return { ok: true, graph: { nodes, roots, rootHash } };
}

/**
 * Parses `trusts:` out of already-split frontmatter. Accepts a YAML flow list
 * or a single value, matching the subset the vault loader already supports.
 */
export function parseTrusts(
  frontmatter: Record<string, string | string[]>,
): string[] {
  const raw = frontmatter.trusts;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((v) => v.replace(/^\[\[|\]\]$/g, "").trim())
    .filter((v) => v.length > 0);
}
