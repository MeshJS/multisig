import type { FlowNode, TokenFlow } from "@/types/token-flow";

/**
 * Merges N single-transaction flows into one graph. Node ids are globally
 * stable, so shared addresses become the join points between transactions
 * (`tx A -> addr X -> tx B`). This is the composition primitive for
 * multi-transaction views (e.g. the transaction-builder feature).
 */
export function mergeTokenFlows(flows: TokenFlow[]): TokenFlow {
  const nodes = new Map<string, FlowNode>();
  const edges = new Map<string, TokenFlow["edges"][number]>();

  for (const flow of flows) {
    for (const node of flow.nodes) {
      const existing = nodes.get(node.id);
      if (!existing) {
        nodes.set(node.id, node);
        continue;
      }
      // Prefer the more informative copy: a resolved label/party type wins
      // over an unknown one.
      if (
        existing.kind === "address" &&
        node.kind === "address" &&
        existing.partyType === "unknown" &&
        node.partyType !== "unknown"
      ) {
        nodes.set(node.id, node);
      }
    }
    for (const edge of flow.edges) {
      // Edge ids embed source/target/kind; tx nodes are unique per tx, so
      // collisions only occur when merging the same transaction twice.
      if (!edges.has(edge.id)) edges.set(edge.id, edge);
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
