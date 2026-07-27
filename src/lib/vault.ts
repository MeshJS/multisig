/**
 * Reads the feature vault at the repository root and turns it into a graph.
 *
 * The vault (`/vault`) is an Obsidian-compatible folder of markdown notes: one per
 * feature, area and state. This module is the only thing that knows the file
 * layout — everything downstream consumes {@link VaultGraph}.
 *
 * **Server-only.** It touches `fs`, so it must be called from `getStaticProps` (or
 * another server context), never from a component. Parsing at build time means the
 * deployed app never reads the vault at runtime, and a malformed note fails the
 * build rather than a request.
 *
 * The frontmatter parser deliberately supports a small YAML subset rather than
 * pulling in a dependency: scalars, inline arrays (`[1, 2]`) and block lists. That
 * is all the vault uses, and it is documented in `vault/README.md`. Anything richer
 * should add a real YAML parser rather than growing this one.
 */
import fs from "fs";
import path from "path";

import {
  FEATURE_STATES,
  type FeatureState,
  type NodeKind,
  type VaultEdge,
  type VaultGraph,
  type VaultNode,
} from "@/lib/vault-types";

// Re-exported so server-side callers need only one import. The browser must import
// from `@/lib/vault-types` directly — anything importing this module gets `fs`.
export {
  FEATURE_STATES,
  type FeatureState,
  type NodeKind,
  type EdgeKind,
  type VaultEdge,
  type VaultGraph,
  type VaultNode,
} from "@/lib/vault-types";

type Frontmatter = Record<string, string | string[]>;

const VAULT_DIR = path.join(process.cwd(), "vault");

/** Strip one layer of matching quotes. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/**
 * Split the `---` fenced frontmatter from the body. Returns empty frontmatter when
 * a note has none, so a stray file never throws.
 */
export function splitFrontmatter(raw: string): {
  frontmatter: Frontmatter;
  body: string;
} {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: normalized };
  }
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: {}, body: normalized };

  const block = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n+/, "");

  const frontmatter: Frontmatter = {};
  let currentKey: string | null = null;

  for (const line of block.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    // Block-list item belonging to the previous key: "  - value"
    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem && currentKey) {
      const existing = frontmatter[currentKey];
      const next = Array.isArray(existing) ? existing : [];
      next.push(unquote(listItem[1] ?? ""));
      frontmatter[currentKey] = next;
      continue;
    }

    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;

    const key = pair[1] ?? "";
    const rawValue = (pair[2] ?? "").trim();
    currentKey = key;

    if (rawValue === "") {
      // Either an empty scalar or the head of a block list; the next line decides.
      frontmatter[key] = [];
      continue;
    }

    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      const inner = rawValue.slice(1, -1).trim();
      frontmatter[key] = inner
        ? inner.split(",").map((part) => unquote(part))
        : [];
      continue;
    }

    frontmatter[key] = unquote(rawValue);
  }

  return { frontmatter, body };
}

function readScalar(fm: Frontmatter, key: string): string | undefined {
  const value = fm[key];
  if (typeof value === "string" && value !== "") return value;
  return undefined;
}

function readNumbers(fm: Frontmatter, key: string): number[] {
  const value = fm[key];
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .map((item) => Number.parseInt(String(item).replace(/^#/, ""), 10))
    .filter((n) => Number.isFinite(n));
}

function isFeatureState(value: string | undefined): value is FeatureState {
  return (
    value !== undefined && (FEATURE_STATES as readonly string[]).includes(value)
  );
}

/** Every `[[wikilink]]` in the body, de-duplicated, ignoring `|` display aliases. */
export function extractWikilinks(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
    const title = (match[1] ?? "").trim();
    if (title) found.add(title);
  }
  return [...found];
}

/** First prose paragraph of a note, with the `# Title` heading removed. */
export function summarize(body: string): string {
  const withoutHeading = body.replace(/^#\s+.*$/m, "").trim();
  const paragraph = withoutHeading.split(/\n\s*\n/)[0] ?? "";
  return paragraph
    .replace(/^##\s+.*$/gm, "")
    .replace(/`/g, "")
    .replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function readNotes(dir: string): { title: string; raw: string }[] {
  const full = path.join(VAULT_DIR, dir);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => ({
      title: name.replace(/\.md$/, ""),
      raw: fs.readFileSync(path.join(full, name), "utf8"),
    }));
}

/**
 * Build the graph. Throws when a feature names an area or state that has no note,
 * so a typo surfaces at build time instead of silently dropping an edge.
 */
export function loadVaultGraph(): VaultGraph {
  const nodes: VaultNode[] = [];
  const edges: VaultEdge[] = [];

  const base = (title: string, kind: NodeKind, body: string): VaultNode => ({
    id: title,
    kind,
    summary: summarize(body),
    issues: [],
    prs: [],
    degree: 0,
  });

  for (const { title, raw } of readNotes("states")) {
    nodes.push(base(title, "state", splitFrontmatter(raw).body));
  }
  for (const { title, raw } of readNotes("areas")) {
    nodes.push(base(title, "area", splitFrontmatter(raw).body));
  }

  const areaTitles = new Set(
    nodes.filter((n) => n.kind === "area").map((n) => n.id),
  );
  // States are titled for display ("In Progress") but referenced by slug
  // ("in-progress"), so map one to the other rather than duplicating the note.
  const stateBySlug = new Map(
    nodes
      .filter((n) => n.kind === "state")
      .map((n) => [n.id.toLowerCase().replace(/\s+/g, "-"), n.id]),
  );

  const featureLinks: { from: string; to: string[] }[] = [];

  for (const { title, raw } of readNotes("features")) {
    const { frontmatter, body } = splitFrontmatter(raw);
    const state = readScalar(frontmatter, "state");
    const area = readScalar(frontmatter, "area");

    if (!isFeatureState(state)) {
      throw new Error(
        `vault: feature "${title}" has state "${state ?? ""}", expected one of ${FEATURE_STATES.join(", ")}`,
      );
    }
    if (!area || !areaTitles.has(area)) {
      throw new Error(
        `vault: feature "${title}" names area "${area ?? ""}", which has no note in vault/areas`,
      );
    }
    const stateTitle = stateBySlug.get(state);
    if (!stateTitle) {
      throw new Error(`vault: no note in vault/states for state "${state}"`);
    }

    nodes.push({
      ...base(title, "feature", body),
      state,
      area,
      owner: readScalar(frontmatter, "owner"),
      milestone: readScalar(frontmatter, "milestone"),
      issues: readNumbers(frontmatter, "issues"),
      prs: readNumbers(frontmatter, "prs"),
    });

    edges.push({ source: title, target: area, kind: "in-area" });
    edges.push({ source: title, target: stateTitle, kind: "has-state" });
    featureLinks.push({ from: title, to: extractWikilinks(body) });
  }

  const featureTitles = new Set(
    nodes.filter((n) => n.kind === "feature").map((n) => n.id),
  );

  // Feature-to-feature links, de-duplicated so a mutual reference is one edge.
  const seen = new Set<string>();
  for (const { from, to } of featureLinks) {
    for (const target of to) {
      if (!featureTitles.has(target) || target === from) continue;
      const key = [from, target].sort().join(" ");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: from, target, kind: "relates-to" });
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of edges) {
    const a = byId.get(edge.source);
    const b = byId.get(edge.target);
    if (a) a.degree += 1;
    if (b) b.degree += 1;
  }

  const counts = FEATURE_STATES.reduce(
    (acc, state) => {
      acc[state] = nodes.filter(
        (n) => n.kind === "feature" && n.state === state,
      ).length;
      return acc;
    },
    {} as Record<FeatureState, number>,
  );

  return { nodes, edges, counts, generatedFrom: "vault/" };
}
