/**
 * The shape of the feature-vault graph, shared by the build-time loader and the
 * browser.
 *
 * Kept apart from `@/lib/vault` on purpose: that module reads the filesystem, so
 * importing any *value* from it — not just a type — would pull `fs` into the client
 * bundle and fail the build. Anything the graph UI needs at runtime belongs here.
 */

export const FEATURE_STATES = [
  "delivered",
  "in-progress",
  "planned",
  "blocked",
] as const;

export type FeatureState = (typeof FEATURE_STATES)[number];

export type NodeKind = "feature" | "area" | "state";

export type VaultNode = {
  /** Note title, which is also its filename and the target of `[[wikilinks]]`. */
  id: string;
  kind: NodeKind;
  /** Prose body with the leading `# Heading` stripped. */
  summary: string;
  state?: FeatureState;
  area?: string;
  owner?: string;
  /** `YYYY-MM` the work landed or is scheduled for. */
  milestone?: string;
  issues: number[];
  prs: number[];
  /** Count of edges touching this node, used to size it in the graph. */
  degree: number;
};

export type EdgeKind = "in-area" | "has-state" | "relates-to";

export type VaultEdge = {
  source: string;
  target: string;
  kind: EdgeKind;
};

export type VaultGraph = {
  nodes: VaultNode[];
  edges: VaultEdge[];
  /** Feature counts keyed by state, for the summary strip. */
  counts: Record<FeatureState, number>;
  generatedFrom: string;
};
