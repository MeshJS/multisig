/**
 * Read `<meta>` tags out of untrusted HTML in linear time.
 *
 * GET /api/v1/og used to run one regex per field of the form
 * `<meta[^>]+property=…[^>]+content=…` over the whole page. On a page with
 * many `<meta` openings and no closing `>`, every opening scans to the end of
 * the document, so a 1 MiB page costs seconds of CPU per regex — and the
 * handler runs several of them on the event loop of a public endpoint. This
 * scanner looks at each tag once and never matches across tags, so the work
 * is proportional to the page size. /api/local/og still has regexes of the
 * same shape and is the natural next caller.
 */

/** A real meta tag is a few hundred characters; anything longer is skipped. */
export const MAX_META_TAG_CHARS = 4096;

/**
 * Map each `property` / `name` key (lower-cased) to its `content`.
 *
 * The first non-empty value for a key wins, as the old first-match regexes
 * did. A key can be declared by `property` (Open Graph) or `name` (standard
 * meta, Twitter cards); both land in the same map, keyed by the attribute
 * kind so `name="title"` never answers for `property="og:title"`.
 */
export function readMetaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  let from = 0;
  while (from < html.length) {
    const start = indexOfMetaOpening(html, from);
    if (start === -1) break;

    // `<metadata>` and friends are not meta tags.
    if (!isTagNameEnd(html.charCodeAt(start + 5))) {
      from = start + 5;
      continue;
    }

    const tag = parseAttributes(html, start + 5);
    if ("skipTo" in tag) {
      // Unterminated or over-long: drop it and carry on from where the parse
      // stopped. Resuming any earlier would re-read the same characters for
      // every `<meta` inside the dropped stretch, which is the quadratic
      // blow-up this module exists to avoid.
      from = tag.skipTo;
      continue;
    }
    from = tag.end + 1;

    const content = tag.attributes.get("content");
    if (!content) continue;
    const property = tag.attributes.get("property");
    if (property) {
      const key = `property:${property.toLowerCase()}`;
      if (!tags.has(key)) tags.set(key, content);
    }
    const name = tag.attributes.get("name");
    if (name) {
      const key = `name:${name.toLowerCase()}`;
      if (!tags.has(key)) tags.set(key, content);
    }
  }
  return tags;
}

/**
 * Tokenize one tag's attributes, starting just after the tag name, in a
 * single forward pass: every character is looked at once, so there is nothing
 * to backtrack. A `>` inside a quoted value does not end the tag. If the tag
 * is not closed within MAX_META_TAG_CHARS, returns where the parse stopped.
 */
function parseAttributes(
  html: string,
  from: number,
): { end: number; attributes: Map<string, string> } | { skipTo: number } {
  const limit = Math.min(html.length, from + MAX_META_TAG_CHARS);
  const attributes = new Map<string, string>();
  let i = from;
  while (i < limit) {
    const c = html.charCodeAt(i);
    if (c === GT) return { end: i, attributes };
    if (isSpace(c) || c === SLASH) {
      i++;
      continue;
    }

    const nameStart = i;
    while (i < limit && !isNameEnd(html.charCodeAt(i))) i++;
    const name = html.slice(nameStart, i).toLowerCase();
    if (i === nameStart) i++; // a stray `=`: step over it

    while (i < limit && isSpace(html.charCodeAt(i))) i++;
    if (html.charCodeAt(i) !== EQUALS) {
      if (name && !attributes.has(name)) attributes.set(name, "");
      continue;
    }
    i++;
    while (i < limit && isSpace(html.charCodeAt(i))) i++;

    let value: string;
    const q = html.charCodeAt(i);
    if (q === DQUOTE || q === SQUOTE) {
      // A bounded walk, not indexOf: an unclosed quote must not cost a scan
      // of the rest of the document.
      let close = i + 1;
      while (close < limit && html.charCodeAt(close) !== q) close++;
      if (close >= limit) return { skipTo: limit };
      value = html.slice(i + 1, close);
      i = close + 1;
    } else {
      const valueStart = i;
      while (i < limit && !isSpace(html.charCodeAt(i)) && html.charCodeAt(i) !== GT) i++;
      value = html.slice(valueStart, i);
    }
    // HTML keeps the first of duplicated attributes.
    if (name && !attributes.has(name)) attributes.set(name, value);
  }
  return { skipTo: Math.max(i, from + 1) };
}

/** The text of the first `<title>` element, if it has any. */
export function readTitle(html: string): string | undefined {
  // Linear: `[^<]+` stops at the next `<`, so no opening rescans past another.
  const match = /<title>([^<]+)<\/title>/i.exec(html);
  return match?.[1];
}

const GT = 0x3e;
const SLASH = 0x2f;
const EQUALS = 0x3d;
const DQUOTE = 0x22;
const SQUOTE = 0x27;

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d;
}

/** Whitespace, `/` or `>` end the tag name; NaN means end of input. */
function isTagNameEnd(code: number): boolean {
  return Number.isNaN(code) || isSpace(code) || code === SLASH || code === GT;
}

function isNameEnd(code: number): boolean {
  return isSpace(code) || code === SLASH || code === GT || code === EQUALS;
}

/** Index of the next `<meta` (any case) at or after `from`, or -1. */
function indexOfMetaOpening(html: string, from: number): number {
  for (let i = html.indexOf("<", from); i !== -1; i = html.indexOf("<", i + 1)) {
    if (html.slice(i + 1, i + 5).toLowerCase() === "meta") return i;
  }
  return -1;
}
