import fs from "fs";
import path from "path";
import type { ArticleMeta } from "@/lib/seo";
import { BLOG_AUTHOR } from "@/lib/seo";

/**
 * File-based blog data layer.
 *
 * Posts are Markdown files in `src/content/blog/*.md` with a small YAML-ish
 * front-matter block. This is server-only (uses `fs`) — call it exclusively from
 * `getServerSideProps` / `getStaticProps` / API routes, never from a component.
 *
 * We deliberately avoid a front-matter dependency (gray-matter): the format is
 * fully under our control, so a tiny parser keeps the feature self-contained.
 */

const BLOG_DIR = path.join(process.cwd(), "src", "content", "blog");

export type BlogPost = {
  meta: ArticleMeta;
  /** Raw Markdown body (front-matter stripped). */
  content: string;
};

/** Parse a single front-matter scalar: JSON string, JSON array, or bare text. */
function parseValue(raw: string): string | string[] {
  const t = raw.trim();
  if (t.startsWith("[")) {
    try {
      return JSON.parse(t) as string[];
    } catch {
      return [];
    }
  }
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

/** Split a raw file into its front-matter object and Markdown body. */
function parseFrontmatter(raw: string): {
  data: Record<string, string | string[]>;
  content: string;
} {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { data: {}, content: normalized.trim() };

  const data: Record<string, string | string[]> = {};
  for (const line of match[1]!.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    data[key] = parseValue(line.slice(idx + 1));
  }
  return { data, content: normalized.slice(match[0].length).trim() };
}

function str(v: string | string[] | undefined, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function toMeta(
  slug: string,
  data: Record<string, string | string[]>,
): ArticleMeta {
  const tags = Array.isArray(data.tags)
    ? data.tags
    : typeof data.tags === "string" && data.tags
      ? data.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];
  // Optional fields are omitted entirely (never set to `undefined`) so the meta
  // stays JSON-serializable for getServerSideProps props.
  const meta: ArticleMeta = {
    slug,
    title: str(data.title, slug),
    description: str(data.description),
    date: str(data.date),
    author: str(data.author) || BLOG_AUTHOR,
  };
  const updated = str(data.updated);
  if (updated) meta.updated = updated;
  if (tags.length) meta.tags = tags;
  const image = str(data.image);
  if (image) meta.image = image;
  return meta;
}

/** All post slugs (filenames without the `.md` extension). */
export function getPostSlugs(): string[] {
  if (!fs.existsSync(BLOG_DIR)) return [];
  return fs
    .readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

/** A single post (metadata + Markdown body), or `null` if the slug is unknown. */
export function getPostBySlug(slug: string): BlogPost | null {
  const safe = slug.replace(/[^a-z0-9-]/gi, "");
  const file = path.join(BLOG_DIR, `${safe}.md`);
  if (!safe || !fs.existsSync(file)) return null;
  const { data, content } = parseFrontmatter(fs.readFileSync(file, "utf8"));
  return { meta: toMeta(safe, data), content };
}

/** All post metadata, newest first. */
export function getAllPostsMeta(): ArticleMeta[] {
  return getPostSlugs()
    .map((slug) => getPostBySlug(slug)?.meta)
    .filter((m): m is ArticleMeta => Boolean(m))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
