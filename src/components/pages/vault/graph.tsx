import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { VaultTrustView } from "@/lib/vault-trust-types";

/**
 * Interactive knowledge graph over the vault, drawing BOTH relations at once
 * because the contrast between them is the thing worth seeing:
 *
 *   - TRUST edges (hub -> feature) are solid and directed. They bear hashes, so
 *     they must stay acyclic — this is the layer a disclosure walks.
 *   - LOGICAL edges (`[[wikilinks]]`) are dashed and undirected. They cycle
 *     freely, and are deliberately absent from every hash.
 *
 * Toggling the logical layer off leaves a clean DAG on screen; toggling it on
 * shows the cycles the commitment had to exclude. That is the argument the page
 * exists to make, so the graph makes it visible rather than asserting it.
 *
 * The simulation is hand-rolled: ~72 nodes make an O(n^2) repulsion pass free,
 * and a force-layout dependency would cost more than it saves.
 */

const VB_W = 900;
const VB_H = 560;
const HUB_R = 9;
const NOTE_R = 5;

type Pt = { id: string; x: number; y: number; vx: number; vy: number };

const STATE_FILL: Record<string, string> = {
  delivered: "fill-green-500",
  "in-progress": "fill-amber-500",
  blocked: "fill-red-500",
  planned: "fill-muted-foreground",
};

/**
 * Deterministic starting positions, so the layout is the same on every load and
 * a reader can build a mental map of it. Hubs start on a ring, their features
 * scattered nearby, which also converges faster than a random cloud.
 */
function seedPositions(view: VaultTrustView): Pt[] {
  const hubIndex = new Map(view.hubs.map((h, i) => [h, i]));
  const n = Math.max(view.hubs.length, 1);

  return view.notes.map((note, i) => {
    const anchor = note.kind === "area" ? note.id : (note.area ?? "");
    const slot = hubIndex.get(anchor) ?? i % n;
    const angle = (slot / n) * Math.PI * 2;
    const spread = note.kind === "area" ? 0 : 60 + ((i * 37) % 70);
    const wobble = ((i * 53) % 100) / 100 - 0.5;

    return {
      id: note.id,
      x: VB_W / 2 + Math.cos(angle + wobble * 0.6) * (170 + spread),
      y: VB_H / 2 + Math.sin(angle + wobble * 0.6) * (140 + spread * 0.7),
      vx: 0,
      vy: 0,
    };
  });
}

export default function VaultGraph({
  view,
  selected,
  onSelect,
  query,
}: {
  view: VaultTrustView;
  selected: string;
  onSelect: (id: string) => void;
  /** Shared with the tree: non-matching nodes fade rather than disappear. */
  query: string;
}) {
  const [showLogical, setShowLogical] = useState(true);
  const [showTrust, setShowTrust] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pos, setPos] = useState<Map<string, Pt>>(new Map());

  const gRef = useRef<SVGGElement | null>(null);
  const nodesRef = useRef<Pt[]>([]);
  const alphaRef = useRef(1);
  const dragRef = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);

  const byId = useMemo(
    () => new Map(view.notes.map((n) => [n.id, n])),
    [view.notes],
  );

  /** Wikilinks, kept only where both ends are in the vault, de-duplicated. */
  const logicalEdges = useMemo(() => {
    const seen = new Set<string>();
    const out: { from: string; to: string }[] = [];
    for (const note of view.notes) {
      for (const link of note.links) {
        if (!byId.has(link) || link === note.id) continue;
        const key = [note.id, link].sort().join("\u0000");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ from: note.id, to: link });
      }
    }
    return out;
  }, [view.notes, byId]);

  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      if (!m.has(a)) m.set(a, new Set());
      m.get(a)!.add(b);
    };
    for (const e of [...view.trustEdges, ...logicalEdges]) {
      add(e.from, e.to);
      add(e.to, e.from);
    }
    return m;
  }, [view.trustEdges, logicalEdges]);

  // ── Simulation ──────────────────────────────────────────────────────────
  const tick = useCallback(() => {
    const nodes = nodesRef.current;
    const alpha = alphaRef.current;
    const index = new Map(nodes.map((n) => [n.id, n]));

    // Repulsion, every pair.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          // Deterministic nudge rather than random, so coincident nodes still
          // separate the same way on every run.
          dx = ((i % 7) - 3) * 0.5 + 0.1;
          dy = ((j % 5) - 2) * 0.5 + 0.1;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const rep = Math.min(2600 / d2, 40);
        const fx = (dx / d) * rep;
        const fy = (dy / d) * rep;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    const spring = (from: string, to: string, rest: number, k: number) => {
      const a = index.get(from);
      const b = index.get(to);
      if (!a || !b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const f = (d - rest) * k;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    };

    // Trust edges hold structure; logical edges only nudge, so the picture is
    // organised by the commitment rather than by prose cross-references.
    for (const e of view.trustEdges) spring(e.from, e.to, 78, 0.09);
    for (const e of logicalEdges) spring(e.from, e.to, 150, 0.012);

    for (const n of nodes) {
      // Weak pull to centre keeps disconnected notes from drifting off-canvas.
      // Anisotropic on purpose: the canvas is far wider than it is tall, so an
      // equal pull settles the cloud against the top and bottom rails while
      // leaving a third of the width empty.
      n.vx += (VB_W / 2 - n.x) * 0.0025;
      n.vy += (VB_H / 2 - n.y) * 0.0075;

      if (dragRef.current === n.id) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }

      n.vx *= 0.82;
      n.vy *= 0.82;
      n.x += n.vx * alpha;
      n.y += n.vy * alpha;
      n.x = Math.max(20, Math.min(VB_W - 20, n.x));
      n.y = Math.max(20, Math.min(VB_H - 20, n.y));
    }

    setPos(new Map(nodes.map((n) => [n.id, { ...n }])));
  }, [view.trustEdges, logicalEdges]);

  useEffect(() => {
    nodesRef.current = seedPositions(view);
    alphaRef.current = 1;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      // Same layout, arrived at instantly.
      for (let i = 0; i < 400; i++) {
        tick();
        alphaRef.current *= 0.985;
      }
      return;
    }

    const loop = () => {
      tick();
      alphaRef.current *= 0.985;
      if (alphaRef.current > 0.02)
        frameRef.current = requestAnimationFrame(loop);
      else frameRef.current = null;
    };
    frameRef.current = requestAnimationFrame(loop);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [view, tick]);

  /** Re-heats the simulation after a drag without restarting the layout. */
  const reheat = useCallback(() => {
    alphaRef.current = Math.max(alphaRef.current, 0.35);
    if (frameRef.current !== null) return;
    const loop = () => {
      tick();
      alphaRef.current *= 0.99;
      if (alphaRef.current > 0.02)
        frameRef.current = requestAnimationFrame(loop);
      else frameRef.current = null;
    };
    frameRef.current = requestAnimationFrame(loop);
  }, [tick]);

  // ── Dragging ────────────────────────────────────────────────────────────
  const toGraph = (e: React.PointerEvent): { x: number; y: number } | null => {
    const ctm = gRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const id = dragRef.current;
    if (!id) return;
    const p = toGraph(e);
    if (!p) return;
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node) return;
    node.x = Math.max(20, Math.min(VB_W - 20, p.x));
    node.y = Math.max(20, Math.min(VB_H - 20, p.y));
    reheat();
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    reheat();
  };

  // ── Emphasis ────────────────────────────────────────────────────────────
  const focus = hovered ?? selected;
  const near = focus
    ? new Set([focus, ...(neighbours.get(focus) ?? [])])
    : null;
  const matches = (id: string) =>
    !query || id.toLowerCase().includes(query.toLowerCase());

  const at = (id: string) => pos.get(id);
  const edgeOpacity = (a: string, b: string) =>
    near ? (near.has(a) && near.has(b) ? 1 : 0.08) : 0.45;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <Toggle on={showTrust} onClick={() => setShowTrust((v) => !v)}>
          <span className="inline-block h-px w-4 bg-primary align-middle" />
          Trust · acyclic · hashed
        </Toggle>
        <Toggle on={showLogical} onClick={() => setShowLogical((v) => !v)}>
          <span className="inline-block h-px w-4 border-t border-dashed border-muted-foreground align-middle" />
          Logical · cycles · unhashed
        </Toggle>
        <span className="ml-auto text-[11px] text-muted-foreground">
          drag to rearrange · click to open
        </span>
      </div>

      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="w-full touch-none rounded-md border border-border bg-background/40"
        role="img"
        aria-label={`Knowledge graph: ${view.notes.length} notes, ${view.trustEdges.length} trust edges, ${logicalEdges.length} logical links`}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <defs>
          <marker
            id="vault-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L8,4 L0,8 z" className="fill-primary" />
          </marker>
        </defs>

        <g ref={gRef}>
          {showLogical &&
            logicalEdges.map((e) => {
              const a = at(e.from);
              const b = at(e.to);
              if (!a || !b) return null;
              return (
                <line
                  key={`l:${e.from}>${e.to}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className="stroke-muted-foreground"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity={edgeOpacity(e.from, e.to) * 0.7}
                />
              );
            })}

          {showTrust &&
            view.trustEdges.map((e) => {
              const a = at(e.from);
              const b = at(e.to);
              if (!a || !b) return null;
              // Stop short of the node so the arrowhead sits on the rim.
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const d = Math.max(Math.hypot(dx, dy), 0.01);
              return (
                <line
                  key={`t:${e.from}>${e.to}`}
                  x1={a.x + (dx / d) * HUB_R}
                  y1={a.y + (dy / d) * HUB_R}
                  x2={b.x - (dx / d) * (NOTE_R + 4)}
                  y2={b.y - (dy / d) * (NOTE_R + 4)}
                  className="stroke-primary"
                  strokeWidth="1.4"
                  markerEnd="url(#vault-arrow)"
                  opacity={edgeOpacity(e.from, e.to)}
                />
              );
            })}

          {view.notes.map((note) => {
            const p = at(note.id);
            if (!p) return null;
            const isHub = note.kind === "area";
            const r = isHub ? HUB_R : NOTE_R;
            const dim = (near && !near.has(note.id)) || !matches(note.id);
            const label = isHub || focus === note.id || near?.has(note.id);

            return (
              <g
                key={note.id}
                opacity={dim ? 0.22 : 1}
                className="cursor-pointer"
                onPointerDown={(e) => {
                  dragRef.current = note.id;
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                }}
                onClick={() => onSelect(note.id)}
                onPointerEnter={() => setHovered(note.id)}
                onPointerLeave={() =>
                  setHovered((h) => (h === note.id ? null : h))
                }
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r + (selected === note.id ? 4 : 0)}
                  className={
                    isHub
                      ? "fill-primary stroke-background"
                      : `${STATE_FILL[note.state ?? "planned"] ?? "fill-muted-foreground"} stroke-background`
                  }
                  strokeWidth="1.5"
                />
                {selected === note.id && (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={r + 8}
                    className="fill-none stroke-primary"
                    strokeWidth="1"
                    opacity="0.6"
                  />
                )}
                {label && (
                  <text
                    x={p.x + r + 4}
                    y={p.y + 3.5}
                    className={`pointer-events-none fill-current ${isHub ? "text-[11px] font-medium" : "text-[10px]"}`}
                  >
                    {note.id.length > 26 ? `${note.id.slice(0, 25)}…` : note.id}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Hubs are filled in the accent; features take the colour of their state.
        Turn the logical layer off and what remains is the DAG the root commits
        to — every cycle on screen belongs to the layer that carries no hashes.
      </p>
    </div>
  );
}

function Toggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors ${
        on
          ? "border-border text-foreground"
          : "border-border/50 text-muted-foreground/50"
      }`}
    >
      {children}
    </button>
  );
}
