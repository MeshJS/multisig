import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { buildTrustGraph, type VaultDoc } from "@/lib/vault-proof/trust-graph";
import { splitFrontmatter } from "@/lib/vault";
import type { VaultTrustView } from "@/lib/vault-trust-types";

/**
 * Derives the trust graph over this repo's own feature vault, at build time.
 *
 * Reads the filesystem, so it must never be imported from a client component —
 * same rule as `@/lib/vault`. The browser gets the serialised
 * {@link VaultTrustView} through getStaticProps instead.
 *
 * WHERE THE TRUST EDGES COME FROM
 *
 * The vault already carries the two relations the construction needs, without
 * anyone having to author `trusts:` frontmatter:
 *
 *   - `area:` in a feature's frontmatter is a DOWNWARD edge from a workstream to
 *     the work in it. Areas never point back at features, so these are acyclic by
 *     construction — which makes each area note a proxy hub, exactly the shape
 *     the shielded sign-off design calls for.
 *   - `[[wikilinks]]` in the body are the LOGICAL relation. They cycle freely
 *     between features and are deliberately excluded from the commitment.
 *
 * So the trust spine is: blinded root -> area hubs -> features. Disclosing the
 * Governance hub proves a governance feature belongs to the vault without naming
 * the other workstreams.
 */

const VAULT_DIR = path.join(process.cwd(), "vault");

/**
 * Salts are derived rather than random.
 *
 * A production vault stores a per-document nonce so a short note cannot be
 * brute-forced from a guessed title. This view has no store, and a random salt
 * would change every hash on every build, so it derives one deterministically.
 * That is fine HERE — the vault is public, there is nothing to withhold — and it
 * is not fine anywhere real. Stated because the difference is easy to miss.
 */
function derivedSalt(id: string): string {
  return createHash("sha256")
    .update(`mesh-vault-view/demo-salt/v1:${id}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

function readDir(dir: string): { title: string; raw: string }[] {
  const full = path.join(VAULT_DIR, dir);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full)
    .filter((name) => name.endsWith(".md") && !name.startsWith("_"))
    .map((name) => ({
      title: name.replace(/\.md$/, ""),
      raw: fs.readFileSync(path.join(full, name), "utf8"),
    }));
}

/** Every `[[wikilink]]` in a body, de-duplicated, ignoring `|` display aliases. */
function wikilinks(body: string): string[] {
  return [
    ...new Set(
      [...body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) =>
        m[1]!.trim(),
      ),
    ),
  ];
}

export function buildVaultTrustView(): VaultTrustView {
  const areas = readDir("areas");
  const features = readDir("features");

  const childrenOfArea = new Map<string, string[]>(
    areas.map((a) => [a.title, []]),
  );
  const orphans: string[] = [];

  const docs: VaultDoc[] = [];
  const notes: VaultTrustView["notes"] = [];

  for (const f of features) {
    const { frontmatter, body } = splitFrontmatter(f.raw);
    const area = typeof frontmatter.area === "string" ? frontmatter.area : "";
    if (area && childrenOfArea.has(area)) childrenOfArea.get(area)!.push(f.title);
    else orphans.push(f.title);

    docs.push({ id: f.title, salt: derivedSalt(f.title), content: f.raw, trusts: [] });
    notes.push({
      id: f.title,
      kind: "feature",
      area: area || null,
      state: typeof frontmatter.state === "string" ? frontmatter.state : null,
      owner: typeof frontmatter.owner === "string" ? frontmatter.owner : null,
      body,
      links: wikilinks(body),
      hash: "",
    });
  }

  for (const a of areas) {
    const { body } = splitFrontmatter(a.raw);
    docs.push({
      id: a.title,
      salt: derivedSalt(a.title),
      content: a.raw,
      trusts: childrenOfArea.get(a.title) ?? [],
    });
    notes.push({
      id: a.title,
      kind: "area",
      area: null,
      state: null,
      owner: null,
      body,
      links: wikilinks(body),
      hash: "",
    });
  }

  const built = buildTrustGraph(docs);
  if (!built.ok) {
    // Loud rather than degraded: a vault whose trust edges do not form a DAG has
    // no commitment, and rendering a graph that claims otherwise would be worse
    // than failing the build.
    throw new Error(`vault trust graph: ${built.errors.join("; ")}`);
  }

  for (const note of notes) {
    note.hash = built.graph.nodes.get(note.id)?.hash ?? "";
  }

  return {
    rootHash: built.graph.rootHash,
    hubs: [...built.graph.roots],
    notes: notes.sort((a, b) => a.id.localeCompare(b.id)),
    trustEdges: [...childrenOfArea.entries()].flatMap(([hub, kids]) =>
      kids.map((child) => ({ from: hub, to: child })),
    ),
    orphans: orphans.sort(),
  };
}
