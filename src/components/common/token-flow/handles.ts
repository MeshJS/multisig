/**
 * Handle ids shared between the layout (which assigns them to edges) and the
 * node components (which render them). React Flow silently drops any edge
 * whose sourceHandle/targetHandle id doesn't exist on the node, so both
 * sides must reference this single source of truth.
 */
export const HANDLES = {
  address: {
    in: "in", // target, left
    out: "out", // source, right
  },
  transaction: {
    in: "in", // target, left — value flow in
    out: "out", // source, right — value flow out
    protoOut: "proto-out", // source, bottom — fee / deposit / burn
    protoIn: "proto-in", // target, bottom — mint / deposit refund
  },
  protocol: {
    topIn: "top-in", // target, top
    topOut: "top-out", // source, top
  },
} as const;
