import { hashNode, hashRoot, type TrustGraph, type VaultDoc } from "./trust-graph";

/**
 * Selective disclosure over the trust graph.
 *
 * To prove one document belongs to the signed vault, reveal it, reveal every
 * document on the trust path up to a root, and hand over the bare hashes of the
 * withheld siblings. The verifier re-hashes upward and checks the result against
 * the signed root.
 *
 * What this proves and what it does not, stated plainly because the boundary is
 * the whole product: it proves MEMBERSHIP - that these exact bytes sit under
 * that exact signed root. It does not prove a PREDICATE. Revealing a document
 * reveals all of it, so "the limit is at least X, without showing X" is out of
 * scope here and belongs to BBS+ or SD-JWT if it is ever needed.
 */

export type DisclosedNode = {
  id: string;
  salt: string;
  content: string;
  /**
   * Hashes of this node's trusted children, in declaration order, each marked
   * disclosed or withheld. A withheld child contributes its hash and nothing
   * else - no title, no size, no content.
   */
  children: readonly { hash: string; disclosed: boolean }[];
};

export type Disclosure = {
  /** The document the disclosure is about. */
  targetId: string;
  /** Root the chain must reconcile to. Compare against the signed value. */
  rootHash: string;
  /** Hashes of the roots not on this path. A count, and nothing more. */
  siblingRootHashes: readonly string[];
  /** Target first, then each ancestor up to and including the root. */
  path: readonly DisclosedNode[];
};

export type DiscloseResult =
  | { ok: true; disclosure: Disclosure }
  | { ok: false; error: string };

function parentsOf(graph: TrustGraph, id: string): string[] {
  const out: string[] = [];
  for (const node of graph.nodes.values()) {
    if (node.trusts.includes(id)) out.push(node.id);
  }
  return out;
}

/**
 * Builds a disclosure for one document under one root.
 *
 * A document may sit under several roots - a spending limit belongs to both the
 * banking facet and the audit facet - so the caller chooses which root to
 * disclose under. That choice is a privacy decision, not a technical one:
 * picking the narrowest facet that contains the target reveals the least.
 */
export function disclose(
  graph: TrustGraph,
  docs: ReadonlyMap<string, VaultDoc>,
  targetId: string,
  underRoot: string,
): DiscloseResult {
  if (!graph.nodes.has(targetId)) {
    return { ok: false, error: `Unknown document "${targetId}"` };
  }
  if (!graph.roots.includes(underRoot)) {
    return { ok: false, error: `"${underRoot}" is not a root of this vault` };
  }

  // Walk up from the target to the chosen root. Breadth-first so the disclosure
  // is the SHORTEST path available, which is also the one revealing fewest
  // intermediate documents.
  const cameFrom = new Map<string, string | null>([[targetId, null]]);
  const queue = [targetId];
  let found = false;
  while (queue.length > 0 && !found) {
    const id = queue.shift()!;
    if (id === underRoot) {
      found = true;
      break;
    }
    for (const parent of parentsOf(graph, id)) {
      if (!cameFrom.has(parent)) {
        cameFrom.set(parent, id);
        queue.push(parent);
      }
    }
  }
  if (!found) {
    return { ok: false, error: `"${targetId}" is not reachable from "${underRoot}"` };
  }

  const chain: string[] = [];
  for (let id: string | undefined = underRoot; id; id = cameFrom.get(id) ?? undefined) {
    chain.push(id);
    if (id === targetId) break;
  }
  chain.reverse();
  const onPath = new Set(chain);

  const path: DisclosedNode[] = chain.map((id) => {
    const node = graph.nodes.get(id)!;
    const doc = docs.get(id)!;
    return {
      id,
      salt: doc.salt,
      content: doc.content,
      children: node.trusts.map((childId) => ({
        hash: graph.nodes.get(childId)!.hash,
        disclosed: onPath.has(childId),
      })),
    };
  });

  return {
    ok: true,
    disclosure: {
      targetId,
      rootHash: graph.rootHash,
      siblingRootHashes: graph.roots
        .filter((id) => id !== underRoot)
        .map((id) => graph.nodes.get(id)!.hash)
        .sort(),
      path,
    },
  };
}

export type VerifyResult =
  | { ok: true; targetId: string; rootHash: string }
  | { ok: false; error: string };

/**
 * Verifies a disclosure offline.
 *
 * Needs nothing but SHA-256 and the expected root - no database, no network, no
 * client from us. That is the property that makes the artefact worth anything to
 * a third party: they can re-implement this function in an afternoon and check
 * our work without trusting us.
 */
export function verifyDisclosure(
  disclosure: Disclosure,
  expectedRootHash: string,
): VerifyResult {
  const { path } = disclosure;
  if (path.length === 0) return { ok: false, error: "Empty disclosure path" };
  if (path[0]!.id !== disclosure.targetId) {
    return { ok: false, error: "Path does not begin at the stated target" };
  }

  // Recompute each disclosed node's hash from its own bytes plus its children's
  // hashes, then check that the child hash the parent claims for the node we
  // just verified is the hash we actually computed. That link is the proof.
  let childHash: string | null = null;
  for (const node of path) {
    const recomputed = hashNode(
      { id: node.id, salt: node.salt, content: node.content, trusts: [] },
      node.children.map((c) => c.hash),
    );

    if (childHash !== null) {
      const disclosedChildren = node.children.filter((c) => c.disclosed);
      if (!disclosedChildren.some((c) => c.hash === childHash)) {
        return {
          ok: false,
          error: `"${node.id}" does not commit to the hash of the node below it`,
        };
      }
    }
    childHash = recomputed;
  }

  const rootHash = hashRoot([childHash!, ...disclosure.siblingRootHashes]);

  if (rootHash !== expectedRootHash) {
    return {
      ok: false,
      error: "Recomputed root does not match the signed root",
    };
  }
  return { ok: true, targetId: disclosure.targetId, rootHash };
}
