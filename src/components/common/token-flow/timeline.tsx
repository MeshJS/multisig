import dynamic from "next/dynamic";

import type { TokenFlowTimelineProps } from "./timeline-canvas";

/**
 * Linked multi-transaction token-flow timeline. React Flow is client-only,
 * so the canvas loads dynamically — its chunk is only fetched when the
 * timeline is actually shown.
 */
const TokenFlowTimeline = dynamic<TokenFlowTimelineProps>(
  () => import("./timeline-canvas"),
  {
    ssr: false,
    loading: () => (
      <div className="h-72 w-full animate-pulse rounded-lg border border-border/50 bg-muted/30 sm:h-80" />
    ),
  },
);

export type { TokenFlowTimelineProps };
export default TokenFlowTimeline;
