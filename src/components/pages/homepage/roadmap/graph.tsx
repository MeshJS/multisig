import React from "react";
import Link from "next/link";
import { ArrowLeft, Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  FEATURE_STATES,
  type FeatureState,
  type VaultEdge,
  type VaultGraph,
  type VaultNode,
} from "@/lib/vault-types";

/**
 * Interactive knowledge graph over the feature vault.
 *
 * The layout is a small force simulation run on mount — repulsion between every
 * pair, springs along edges, and a pull toward the centre — rather than a graph
 * dependency. At this size (tens of nodes) the O(n²) pass is cheap, and it keeps
 * the wallet's dependency surface unchanged.
 *
 * The simulation is settled *before paint* rather than animated: it runs a fixed
 * number of iterations in a `useMemo`, so there is no motion to sit through and
 * nothing to reflow on every frame. Dragging a node re-runs a short relaxation
 * from the current positions.
 */

type Props = { graph: VaultGraph };

const STATE_LABEL: Record<FeatureState, string> = {
  delivered: "Delivered",
  "in-progress": "In progress",
  planned: "Planned",
  blocked: "Blocked",
};

/**
 * Emerald / blue / amber stay distinguishable under the common forms of colour
 * blindness; every use is paired with a text label, and the legend doubles as the
 * filter, so colour is never the only channel.
 */
const STATE_DOT: Record<FeatureState, string> = {
  delivered: "bg-emerald-500",
  "in-progress": "bg-blue-500",
  planned: "bg-muted-foreground/40",
  blocked: "bg-amber-500",
};

const STATE_STROKE: Record<FeatureState, string> = {
  delivered: "stroke-emerald-600 dark:stroke-emerald-400",
  "in-progress": "stroke-blue-600 dark:stroke-blue-400",
  planned: "stroke-muted-foreground/50",
  blocked: "stroke-amber-600 dark:stroke-amber-400",
};

const STATE_FILL: Record<FeatureState, string> = {
  delivered: "fill-emerald-500/25",
  "in-progress": "fill-blue-500/25",
  planned: "fill-muted",
  blocked: "fill-amber-500/30",
};

const WIDTH = 1000;
const HEIGHT = 680;

type Point = { x: number; y: number };
type Positions = Record<string, Point>;

/** Deterministic [0,1) hash, so the layout is identical on server and client. */
function seededUnit(key: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function radiusFor(node: VaultNode): number {
  if (node.kind === "state") return 26;
  if (node.kind === "area") return 20;
  return 7 + Math.min(node.degree, 8) * 1.2;
}

/**
 * Relax the layout. Areas and states carry more mass so they anchor their
 * clusters instead of being flung out by their many edges.
 */
function simulate(
  nodes: VaultNode[],
  edges: VaultEdge[],
  start: Positions,
  iterations: number,
  /** Nodes the user has dragged: they exert force but never move. */
  pinned: ReadonlySet<string> = new Set(),
): Positions {
  const pos: Positions = {};
  for (const n of nodes) {
    const p = start[n.id];
    pos[n.id] = p
      ? { x: p.x, y: p.y }
      : {
          x: WIDTH / 2 + (seededUnit(n.id, 1) - 0.5) * WIDTH * 0.75,
          y: HEIGHT / 2 + (seededUnit(n.id, 2) - 0.5) * HEIGHT * 0.75,
        };
  }

  const mass = (n: VaultNode) =>
    n.kind === "state" ? 5 : n.kind === "area" ? 3 : 1;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (let step = 0; step < iterations; step++) {
    const cool = 1 - step / (iterations + 1);
    const force: Positions = {};
    for (const n of nodes) force[n.id] = { x: 0, y: 0 };

    // Repulsion between every pair.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const pa = pos[a.id]!;
        const pb = pos[b.id]!;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) {
          // Identical positions have no direction; nudge deterministically.
          dx = seededUnit(a.id + b.id, 3) - 0.5;
          dy = seededUnit(b.id + a.id, 4) - 0.5;
          dist = 0.01;
        }
        // Hubs are the only labelled nodes, so push them apart harder than
        // features — otherwise two area labels land on top of each other.
        const bothHubs = a.kind !== "feature" && b.kind !== "feature";
        const push =
          ((bothHubs ? 96000 : 38000) * (mass(a) + mass(b))) /
          (dist * dist * 2);
        const ux = (dx / dist) * push;
        const uy = (dy / dist) * push;
        force[a.id]!.x += ux / mass(a);
        force[a.id]!.y += uy / mass(a);
        force[b.id]!.x -= ux / mass(b);
        force[b.id]!.y -= uy / mass(b);
      }
    }

    // Springs along edges.
    for (const e of edges) {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) continue;
      const pa = pos[a.id]!;
      const pb = pos[b.id]!;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.01);
      // Area edges rest longer than state edges, so areas splay into their own
      // neighbourhoods rather than piling onto the state hubs.
      const rest = e.kind === "in-area" ? 118 : e.kind === "has-state" ? 190 : 96;
      const pull = (dist - rest) * 0.045;
      const ux = (dx / dist) * pull;
      const uy = (dy / dist) * pull;
      force[a.id]!.x += ux / mass(a);
      force[a.id]!.y += uy / mass(a);
      force[b.id]!.x -= ux / mass(b);
      force[b.id]!.y -= uy / mass(b);
    }

    // Gentle pull to centre so nothing drifts off-canvas.
    for (const n of nodes) {
      const p = pos[n.id]!;
      force[n.id]!.x += (WIDTH / 2 - p.x) * 0.012;
      force[n.id]!.y += (HEIGHT / 2 - p.y) * 0.012;
    }

    for (const n of nodes) {
      if (pinned.has(n.id)) continue;
      const p = pos[n.id]!;
      const f = force[n.id]!;
      const limit = 28 * cool;
      p.x += Math.max(-limit, Math.min(limit, f.x * cool));
      p.y += Math.max(-limit, Math.min(limit, f.y * cool));
      // Hubs are always labelled, so keep them far enough from the bottom and top
      // edges that the label has somewhere to sit.
      const pad = radiusFor(n) + (n.kind === "feature" ? 6 : 30);
      p.x = Math.max(pad, Math.min(WIDTH - pad, p.x));
      p.y = Math.max(pad, Math.min(HEIGHT - pad, p.y));
    }
  }

  return pos;
}

export function VaultGraphView({ graph }: Props) {
  const [activeStates, setActiveStates] = React.useState<Set<FeatureState>>(
    () => new Set(FEATURE_STATES),
  );
  const [query, setQuery] = React.useState("");
  const [showStates, setShowStates] = React.useState(true);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [hovered, setHovered] = React.useState<string | null>(null);
  /** Where the next relaxation starts from, so a drag nudges rather than reshuffles. */
  const [seed, setSeed] = React.useState<Positions>({});
  /** Only the nodes the user actually dragged stay put. */
  const [pinnedIds, setPinnedIds] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  /** The node under an in-flight drag, tracked outside the layout memo. */
  const [live, setLive] = React.useState<(Point & { id: string }) | null>(null);
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const gesture = React.useRef<{
    id: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);

  const visibleNodes = React.useMemo(() => {
    return graph.nodes.filter((n) => {
      if (n.kind === "feature") return activeStates.has(n.state!);
      // Every feature links to both its area and its state, so two hub systems
      // pull on the same nodes. Dropping the state hubs untangles the layout into
      // pure area structure, which is the more useful view of the product.
      if (n.kind === "state") return showStates;
      return true;
    });
  }, [graph.nodes, activeStates, showStates]);

  const visibleIds = React.useMemo(
    () => new Set(visibleNodes.map((n) => n.id)),
    [visibleNodes],
  );

  const visibleEdges = React.useMemo(
    () =>
      graph.edges.filter(
        (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
      ),
    [graph.edges, visibleIds],
  );

  const layout = React.useMemo(
    () => simulate(visibleNodes, visibleEdges, seed, 320, pinnedIds),
    [visibleNodes, visibleEdges, seed, pinnedIds],
  );

  /**
   * Render positions. A drag in flight moves only the dragged node — re-running the
   * simulation on every pointer move would be both janky and disorienting, so the
   * relaxation happens once, on release.
   */
  const positions = React.useMemo(
    () => (live ? { ...layout, [live.id]: { x: live.x, y: live.y } } : layout),
    [layout, live],
  );

  /**
   * Hubs are always labelled, so two that settle near each other collide. Walk them
   * in a stable order and flip a label above its node when the slot below is taken.
   * Width is approximated from the character count — good enough to separate them,
   * and it avoids measuring text during render.
   */
  const labelDy = React.useMemo(() => {
    const placed: { x1: number; x2: number; y1: number; y2: number }[] = [];
    const offsets: Record<string, number> = {};
    const hubs = visibleNodes
      .filter((n) => n.kind !== "feature")
      .sort((a, b) => a.id.localeCompare(b.id));

    for (const hub of hubs) {
      const p = layout[hub.id];
      if (!p) continue;
      const r = radiusFor(hub);
      // Slightly over-estimate the rendered width (semibold 11px) plus padding —
      // under-estimating is what lets two labels sit on top of each other.
      const halfWidth = (hub.id.length * 6.6 + 10) / 2;
      // Below, above, then progressively further out in each direction.
      const candidates = [
        r + 12,
        -(r + 6),
        r + 26,
        -(r + 20),
        r + 40,
        -(r + 34),
      ];

      const boxFor = (dy: number) => ({
        x1: p.x - halfWidth,
        x2: p.x + halfWidth,
        y1: p.y + dy - 10,
        y2: p.y + dy + 3,
      });
      const usable = (b: ReturnType<typeof boxFor>) =>
        b.y1 > 2 &&
        b.y2 < HEIGHT - 2 &&
        !placed.some(
          (o) => b.x1 < o.x2 && o.x1 < b.x2 && b.y1 < o.y2 && o.y1 < b.y2,
        );

      const chosen = candidates.find((dy) => usable(boxFor(dy)));
      const dy = chosen ?? candidates[0]!;
      offsets[hub.id] = dy;
      placed.push(boxFor(dy));
    }
    return offsets;
  }, [visibleNodes, layout]);

  /** Neighbours of the focused node, used to dim everything else. */
  const focusId = hovered ?? selected;
  const neighbours = React.useMemo(() => {
    if (!focusId) return null;
    const set = new Set<string>([focusId]);
    for (const e of visibleEdges) {
      if (e.source === focusId) set.add(e.target);
      if (e.target === focusId) set.add(e.source);
    }
    return set;
  }, [focusId, visibleEdges]);

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(
      visibleNodes
        .filter(
          (n) =>
            n.id.toLowerCase().includes(q) ||
            n.summary.toLowerCase().includes(q) ||
            (n.area ?? "").toLowerCase().includes(q) ||
            (n.owner ?? "").toLowerCase().includes(q),
        )
        .map((n) => n.id),
    );
  }, [query, visibleNodes]);

  const nodeById = React.useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph.nodes],
  );
  const detail = selected ? nodeById.get(selected) : undefined;

  const toggleState = (state: FeatureState) => {
    setActiveStates((prev) => {
      const next = new Set(prev);
      if (next.has(state)) {
        // Never let the last filter be switched off — an empty graph reads as broken.
        if (next.size > 1) next.delete(state);
      } else {
        next.add(state);
      }
      return next;
    });
  };

  /** Convert a pointer event to SVG user units, so drag tracks the cursor at any scale. */
  const toSvgPoint = (event: React.PointerEvent): Point | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    };
  };

  const onPointerDown = (id: string) => (event: React.PointerEvent) => {
    const point = toSvgPoint(event);
    if (!point) return;
    // Record the gesture but change nothing yet: touching state here would move the
    // node out from under the cursor and the click would never complete.
    gesture.current = { id, x: point.x, y: point.y, moved: false };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const point = toSvgPoint(event);
    if (!point) return;
    if (!g.moved && Math.hypot(point.x - g.x, point.y - g.y) < 5) return;
    g.moved = true;
    setLive({ id: g.id, x: point.x, y: point.y });
  };

  const endDrag = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.moved || !live) {
      setLive(null);
      return;
    }
    // Commit: everything restarts from where it currently sits, and only the
    // dropped node is pinned so the rest can relax around it.
    setSeed({ ...layout, [live.id]: { x: live.x, y: live.y } });
    setPinnedIds((prev) => new Set(prev).add(live.id));
    setLive(null);
  };

  // Dimmed rather than hidden, so the surrounding shape stays readable — on a dark
  // ground anything below about a quarter opacity disappears entirely.
  const opacityFor = (id: string) => {
    if (matches && !matches.has(id)) return 0.2;
    if (neighbours && !neighbours.has(id)) return 0.25;
    return 1;
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* controls */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {FEATURE_STATES.map((state) => {
            const on = activeStates.has(state);
            return (
              <button
                key={state}
                type="button"
                onClick={() => toggleState(state)}
                aria-pressed={on}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  on
                    ? "border-foreground/25 bg-muted text-foreground"
                    : "border-border text-muted-foreground/60 hover:text-muted-foreground"
                }`}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${STATE_DOT[state]} ${on ? "" : "opacity-40"}`}
                />
                {STATE_LABEL[state]}
                <span className="tabular-nums opacity-60">
                  {graph.counts[state]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowStates((v) => !v)}
            aria-pressed={showStates}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              showStates
                ? "border-foreground/25 bg-muted text-foreground"
                : "border-border text-muted-foreground/60 hover:text-muted-foreground"
            }`}
          >
            State links
          </button>
          <div className="relative w-full md:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search features…"
              aria-label="Search features"
              className="h-9 pl-9 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        {/* graph */}
        <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card/40">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-[440px] w-full touch-none sm:h-[560px] lg:h-[620px]"
            role="img"
            aria-label={`Knowledge graph of ${visibleNodes.length} notes and ${visibleEdges.length} links between them`}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            <g>
              {visibleEdges.map((e, i) => {
                const a = positions[e.source];
                const b = positions[e.target];
                if (!a || !b) return null;
                const lit =
                  !neighbours ||
                  (neighbours.has(e.source) && neighbours.has(e.target));
                return (
                  <line
                    key={`${e.source}-${e.target}-${e.kind}-${i}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className={
                      e.kind === "relates-to"
                        ? "stroke-foreground/25"
                        : "stroke-foreground/12"
                    }
                    strokeWidth={e.kind === "relates-to" ? 1.1 : 0.8}
                    strokeDasharray={e.kind === "has-state" ? "3 3" : undefined}
                    opacity={lit ? 1 : 0.08}
                  />
                );
              })}
            </g>

            <g>
              {visibleNodes.map((node) => {
                const p = positions[node.id];
                if (!p) return null;
                const r = radiusFor(node);
                const isFeature = node.kind === "feature";
                const stroke = isFeature
                  ? STATE_STROKE[node.state!]
                  : "stroke-foreground/60";
                const fill = isFeature
                  ? STATE_FILL[node.state!]
                  : node.kind === "state"
                    ? "fill-background"
                    : "fill-muted";
                const isSelected = selected === node.id;
                // Hubs stay labelled; feature labels appear on demand, otherwise
                // 52 of them collide into an unreadable mat of text.
                const showLabel =
                  !isFeature ||
                  isSelected ||
                  hovered === node.id ||
                  (matches?.has(node.id) ?? false);

                return (
                  <g
                    key={node.id}
                    opacity={opacityFor(node.id)}
                    className="cursor-pointer focus:outline-none"
                    tabIndex={0}
                    role="button"
                    aria-label={`${node.id}${isFeature ? `, ${STATE_LABEL[node.state!]}` : `, ${node.kind}`}`}
                    onPointerDown={onPointerDown(node.id)}
                    onPointerEnter={() => setHovered(node.id)}
                    onPointerLeave={() => setHovered(null)}
                    onFocus={() => setHovered(node.id)}
                    onBlur={() => setHovered(null)}
                    onClick={() =>
                      setSelected((cur) => (cur === node.id ? null : node.id))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected((cur) =>
                          cur === node.id ? null : node.id,
                        );
                      }
                    }}
                  >
                    {isSelected && (
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={r + 5}
                        className="fill-none stroke-foreground/70"
                        strokeWidth={1.5}
                      />
                    )}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={r}
                      className={`${fill} ${stroke}`}
                      strokeWidth={node.kind === "feature" ? 1.6 : 2}
                    />
                    {showLabel && (
                      // Anchor labels inward near the edges, or a long hub name
                      // runs outside the viewBox and gets clipped.
                      <text
                        x={
                          p.x < 130
                            ? p.x - r
                            : p.x > WIDTH - 130
                              ? p.x + r
                              : p.x
                        }
                        y={p.y + (labelDy[node.id] ?? r + 12)}
                        textAnchor={
                          p.x < 130
                            ? "start"
                            : p.x > WIDTH - 130
                              ? "end"
                              : "middle"
                        }
                        className={`pointer-events-none select-none ${
                          isFeature
                            ? "fill-foreground/85 text-[10px]"
                            : "fill-foreground text-[11px] font-semibold"
                        }`}
                      >
                        {node.id}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        {/* detail panel */}
        <aside className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card/40 p-4">
          {detail ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold leading-snug">
                  {detail.id}
                </h3>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label="Clear selection"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {detail.kind === "feature" && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[detail.state!]}`}
                    />
                    {STATE_LABEL[detail.state!]}
                  </span>
                  {detail.area && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                      {detail.area}
                    </span>
                  )}
                  {detail.owner && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                      {detail.owner}
                    </span>
                  )}
                  {detail.milestone && (
                    <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {detail.milestone}
                    </span>
                  )}
                </div>
              )}

              <p className="text-xs leading-relaxed text-muted-foreground">
                {detail.summary}
              </p>

              {(detail.issues.length > 0 || detail.prs.length > 0) && (
                <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
                  {detail.issues.map((n) => (
                    <a
                      key={`i${n}`}
                      href={`https://github.com/MeshJS/multisig/issues/${n}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      #{n}
                    </a>
                  ))}
                  {detail.prs.map((n) => (
                    <a
                      key={`p${n}`}
                      href={`https://github.com/MeshJS/multisig/pull/${n}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      PR {n}
                    </a>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Connected
                </span>
                {visibleEdges
                  .filter(
                    (e) => e.source === detail.id || e.target === detail.id,
                  )
                  .map((e, i) => {
                    const other =
                      e.source === detail.id ? e.target : e.source;
                    return (
                      <button
                        key={`${other}-${i}`}
                        type="button"
                        onClick={() => setSelected(other)}
                        className="truncate text-left text-xs text-muted-foreground hover:text-foreground"
                      >
                        {other}
                      </button>
                    );
                  })}
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">
                {visibleNodes.length} notes · {visibleEdges.length} links
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Every feature links to its area and its state, plus the features
                it references. Click a node to read it, drag to rearrange, and
                use the filters to isolate a state.
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Big circles are areas and states; the size of a feature reflects
                how connected it is.
              </p>
            </div>
          )}
        </aside>
      </div>

      <p className="text-xs text-muted-foreground">
        Generated from{" "}
        <code className="font-mono">{graph.generatedFrom}</code> at build time —
        edit a note there and the graph follows.{" "}
        <Link
          href="/roadmap"
          className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to the roadmap
        </Link>
      </p>
    </div>
  );
}

export default VaultGraphView;
