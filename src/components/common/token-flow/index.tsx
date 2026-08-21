import dynamic from "next/dynamic";

import type { TokenFlowVizProps } from "./flow-canvas";

/**
 * Token-flow visualization: wallets/addresses as nodes, token movement as
 * edges, one graph per (or spanning several) transaction(s). React Flow is
 * client-only, so the canvas loads dynamically — its chunk is only fetched
 * when a flow is actually shown.
 */
const TokenFlowViz = dynamic<TokenFlowVizProps>(() => import("./flow-canvas"), {
  ssr: false,
  loading: () => (
    <div className="h-72 w-full animate-pulse rounded-lg border border-border/50 bg-muted/30 sm:h-80" />
  ),
});

export type { TokenFlowVizProps };
export default TokenFlowViz;
