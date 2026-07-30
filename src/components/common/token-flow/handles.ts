/**
 * Handle ids shared between the layout (which assigns them to edges) and the
 * node components (which render them). React Flow silently drops any edge
 * whose sourceHandle/targetHandle id doesn't exist on the node, so both
 * sides must reference this single source of truth.
 *
 * Value flow uses per-edge indexed ports: every edge attached to a card gets
 * its own connector dot (`in-0`, `in-1`, … on the left; `out-0`, … on the
 * right) instead of all edges converging on one shared handle. The layout
 * counts each card's ports and grows the card vertically so consecutive
 * connectors always sit at least PORT_SPACING apart.
 */
export const PORT_SPACING = 28;

export const valuePortIn = (index: number): string => `in-${index}`;
export const valuePortOut = (index: number): string => `out-${index}`;

export const isValuePortIn = (id: string | null | undefined): boolean =>
  !!id && /^in-\d+$/.test(id);
export const isValuePortOut = (id: string | null | undefined): boolean =>
  !!id && /^out-\d+$/.test(id);

/** Even vertical distribution of `count` ports over the card height, in %. */
export const portTopPercent = (index: number, count: number): number =>
  ((index + 1) / (count + 1)) * 100;

/** Minimum card height that keeps `count` ports PORT_SPACING apart. */
export const portStackHeight = (count: number): number =>
  (count + 1) * PORT_SPACING;

export const HANDLES = {
  transaction: {
    protoOut: "proto-out", // source, bottom — fee / deposit / burn
    protoIn: "proto-in", // target, bottom — mint / deposit refund
  },
  protocol: {
    topIn: "top-in", // target, top
    topOut: "top-out", // source, top
  },
} as const;
