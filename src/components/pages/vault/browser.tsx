import { FileText, Folder, Link2, Network, Shield } from "lucide-react";
import { useMemo, useState } from "react";

import VaultGraph from "@/components/pages/vault/graph";
import NoteBody from "@/components/pages/vault/note-body";
import { disclosureFor, type VaultTrustView } from "@/lib/vault-trust-types";

/**
 * Obsidian-style browser over the feature vault, with the trust graph as an
 * overlay rather than a separate screen.
 *
 * The point of putting them together: in this construction the drill-down IS the
 * disclosure path. Selecting a note shows the documents a proof of that note
 * would reveal, and the siblings it would keep sealed — so navigating the vault
 * and understanding what disclosing it costs are the same gesture.
 */

function short(hash: string): string {
  return hash ? `${hash.slice(0, 8)}…` : "—";
}

const STATE_TONE: Record<string, string> = {
  delivered: "text-green-400 border-green-400/30",
  "in-progress": "text-amber-400 border-amber-400/30",
  planned: "text-muted-foreground border-border",
  blocked: "text-red-400 border-red-400/30",
};

export default function VaultBrowser({ view }: { view: VaultTrustView }) {
  const [selected, setSelected] = useState<string>(view.hubs[0] ?? "");
  const [query, setQuery] = useState("");
  const [showTrust, setShowTrust] = useState(true);
  const [mode, setMode] = useState<"browse" | "graph">("browse");

  const byId = useMemo(
    () => new Map(view.notes.map((n) => [n.id, n])),
    [view.notes],
  );

  const childrenOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of view.trustEdges) {
      if (!m.has(e.from)) m.set(e.from, []);
      m.get(e.from)!.push(e.to);
    }
    for (const list of m.values()) list.sort();
    return m;
  }, [view.trustEdges]);

  const note = byId.get(selected);
  const disclosure = useMemo(
    () => (selected ? disclosureFor(view, selected) : null),
    [view, selected],
  );
  const onPath = new Set(disclosure?.path ?? []);

  const matches = (id: string) =>
    !query || id.toLowerCase().includes(query.toLowerCase());

  return (
    <div className="space-y-3">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the vault"
          aria-label="Search the vault"
          className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="ml-auto flex rounded-md border border-border p-0.5 text-sm">
          {(["browse", "graph"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`flex items-center gap-1.5 rounded px-3 py-1 capitalize transition-colors ${
                mode === m
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "browse" ? (
                <Folder className="h-3.5 w-3.5" />
              ) : (
                <Network className="h-3.5 w-3.5" />
              )}
              {m}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`grid gap-4 ${
          mode === "browse"
            ? "lg:grid-cols-[280px_minmax(0,1fr)_300px]"
            : "lg:grid-cols-[minmax(0,1fr)_300px]"
        }`}
      >
        {/* ── Tree ───────────────────────────────────────────────────────── */}
        {mode === "browse" && (
          <aside className="rounded-lg border border-border bg-card/60 p-3">
            <nav className="space-y-3 text-sm">
              {view.hubs.map((hub) => {
                const kids = (childrenOf.get(hub) ?? []).filter(matches);
                if (!matches(hub) && kids.length === 0) return null;
                return (
                  <div key={hub}>
                    <button
                      onClick={() => setSelected(hub)}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors ${
                        selected === hub
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Folder className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate font-medium">{hub}</span>
                      <span className="font-mono text-[10px] opacity-60">
                        {(childrenOf.get(hub) ?? []).length}
                      </span>
                    </button>
                    <div className="ml-3 border-l border-border pl-2">
                      {kids.map((id) => (
                        <button
                          key={id}
                          onClick={() => setSelected(id)}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors ${
                            selected === id
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          } ${showTrust && onPath.has(id) ? "ring-1 ring-inset ring-primary/40" : ""}`}
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
                          <span className="truncate">{id}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {view.orphans.filter(matches).length > 0 && (
                <div>
                  <div className="px-2 py-1 text-xs text-muted-foreground">
                    Outside the spine
                  </div>
                  {view.orphans.filter(matches).map((id) => (
                    <button
                      key={id}
                      onClick={() => setSelected(id)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-muted-foreground hover:text-foreground"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 opacity-40" />
                      <span className="truncate">{id}</span>
                    </button>
                  ))}
                </div>
              )}
            </nav>
          </aside>
        )}

        {/* ── Reader / Graph ─────────────────────────────────────────────── */}
        {mode === "graph" ? (
          <section className="min-w-0 rounded-lg border border-border bg-card/60 p-4">
            <VaultGraph
              view={view}
              selected={selected}
              onSelect={setSelected}
              query={query}
            />
          </section>
        ) : (
          <article className="min-w-0 rounded-lg border border-border bg-card/60 p-5">
            {note ? (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight">
                    {note.id}
                  </h2>
                  {note.state && (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${
                        STATE_TONE[note.state] ??
                        "border-border text-muted-foreground"
                      }`}
                    >
                      {note.state}
                    </span>
                  )}
                  {note.owner && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      {note.owner}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                    {short(note.hash)}
                  </span>
                </div>

                <NoteBody
                  body={note.body}
                  noteId={note.id}
                  exists={(id) => byId.has(id)}
                  onNavigate={setSelected}
                />

                {note.links.length > 0 && (
                  <div className="mt-5 border-t border-border pt-4">
                    <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Link2 className="h-3.5 w-3.5" />
                      Logical links — names only, no hash dependency, may cycle
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {note.links.map((l) => (
                        <button
                          key={l}
                          onClick={() => byId.has(l) && setSelected(l)}
                          disabled={!byId.has(l)}
                          className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors enabled:hover:text-foreground disabled:opacity-40"
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Select a note.</p>
            )}
          </article>
        )}

        {/* ── Trust overlay ────────────────────────────────────────────────── */}
        <aside className="rounded-lg border border-border bg-card/60 p-4">
          <button
            onClick={() => setShowTrust((v) => !v)}
            className="mb-3 flex w-full items-center gap-2 text-left text-sm font-medium"
          >
            <Shield className="h-4 w-4" />
            <span className="flex-1">Trust path</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {showTrust ? "on" : "off"}
            </span>
          </button>

          {showTrust && disclosure && (
            <>
              <TrustPath path={disclosure.path} rootHash={view.rootHash} />

              <div className="mt-4 border-t border-border pt-3">
                <div className="mb-1.5 text-xs text-muted-foreground">
                  Withheld — hash only
                </div>
                <div className="space-y-1">
                  {disclosure.withheld.slice(0, 8).map((id) => (
                    <div
                      key={id}
                      className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground/70"
                    >
                      <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                      {short(byId.get(id)?.hash ?? "")}
                    </div>
                  ))}
                  {disclosure.withheld.length > 8 && (
                    <div className="font-mono text-[11px] text-muted-foreground/50">
                      +{disclosure.withheld.length - 8} more
                    </div>
                  )}
                  {disclosure.withheld.length === 0 && (
                    <div className="text-[11px] text-muted-foreground/60">
                      Nothing withheld.
                    </div>
                  )}
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/70">
                  A verifier receives the path, these hashes, and the signed
                  root — then re-hashes upward. Titles never leave.
                </p>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

/**
 * The path from the selected note up to the blinded root, drawn bottom-up and
 * animated on every selection change.
 *
 * The animation is not decoration: it traces the order a verifier recomputes in,
 * which is the thing the picture is for. `key` on the group restarts it whenever
 * the path changes.
 */
function TrustPath({ path, rootHash }: { path: string[]; rootHash: string }) {
  const rows = [...path].reverse();
  const step = 46;
  const height = (rows.length + 1) * step + 10;

  return (
    <svg
      viewBox={`0 0 260 ${height}`}
      className="w-full"
      role="img"
      aria-label={`Trust path: ${["blinded root", ...rows].join(" then ")}`}
    >
      <g key={path.join(">")}>
        <g>
          <rect
            x="8"
            y="6"
            width="244"
            height="30"
            rx="5"
            className="fill-primary/15 stroke-primary/50"
            strokeWidth="1"
          />
          <text x="20" y="20" className="fill-current text-[10px] font-medium">
            blinded root
          </text>
          <text
            x="20"
            y="31"
            className="fill-current font-mono text-[9px] opacity-60"
          >
            {rootHash.slice(0, 16)}…
          </text>
        </g>

        {rows.map((id, i) => {
          const y = (i + 1) * step + 6;
          return (
            <g key={id}>
              <line
                x1="24"
                y1={y - step + 36}
                x2="24"
                y2={y}
                className="stroke-primary/60"
                strokeWidth="1.5"
                strokeDasharray="40"
                strokeDashoffset="40"
              >
                <animate
                  attributeName="stroke-dashoffset"
                  from="40"
                  to="0"
                  dur="0.35s"
                  begin={`${i * 0.18}s`}
                  fill="freeze"
                />
              </line>
              <rect
                x="8"
                y={y}
                width="244"
                height="30"
                rx="5"
                className="fill-muted stroke-border"
                strokeWidth="1"
                opacity="0"
              >
                <animate
                  attributeName="opacity"
                  from="0"
                  to="1"
                  dur="0.3s"
                  begin={`${i * 0.18 + 0.15}s`}
                  fill="freeze"
                />
              </rect>
              <text
                x="20"
                y={y + 19}
                className="fill-current text-[11px]"
                opacity="0"
              >
                {id.length > 30 ? `${id.slice(0, 29)}…` : id}
                <animate
                  attributeName="opacity"
                  from="0"
                  to="1"
                  dur="0.3s"
                  begin={`${i * 0.18 + 0.15}s`}
                  fill="freeze"
                />
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
