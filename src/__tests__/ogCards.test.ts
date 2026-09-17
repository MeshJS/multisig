import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  OG_CARD,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_PATH,
  OG_IMAGE_VERSION,
  OG_IMAGE_WIDTH,
  getRouteSeo,
  ogImageUrl,
  routeSeo,
} from "@/lib/seo";

/**
 * The social cards are committed PNGs produced by scripts/generate-og-image.mjs
 * and referenced by path from seo.ts. Nothing at build time links the two, so a
 * renamed or forgotten card would ship as a broken og:image and only surface
 * when someone shared a link. These tests are that link.
 */

const PUBLIC_DIR = join(process.cwd(), "public");

/** Read width/height straight out of the PNG IHDR chunk — no image library. */
function pngSize(absPath: string): { width: number; height: number } {
  const buf = readFileSync(absPath);
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const allCards = [OG_IMAGE_PATH, ...Object.values(OG_CARD)];

describe("Open Graph cards", () => {
  it.each(allCards)("%s exists in /public", (cardPath) => {
    expect(existsSync(join(PUBLIC_DIR, cardPath))).toBe(true);
  });

  it.each(allCards)("%s is a %sx%s PNG", (cardPath) => {
    // Facebook, X and LinkedIn all crop away from 1.91:1; an off-size card gets
    // letterboxed or centre-cropped through the headline.
    expect(pngSize(join(PUBLIC_DIR, cardPath))).toEqual({
      width: OG_IMAGE_WIDTH,
      height: OG_IMAGE_HEIGHT,
    });
  });

  it("gives every card a distinct file", () => {
    expect(new Set(allCards).size).toBe(allCards.length);
  });

  it("only points routes at cards that exist", () => {
    for (const [pathname, entry] of Object.entries(routeSeo)) {
      if (!entry.image) continue;
      expect([pathname, existsSync(join(PUBLIC_DIR, entry.image))]).toEqual([
        pathname,
        true,
      ]);
    }
  });

  it("pairs every route-level card with alt text", () => {
    for (const [pathname, entry] of Object.entries(routeSeo)) {
      if (!entry.image) continue;
      expect([pathname, entry.imageAlt?.length ?? 0]).not.toEqual([pathname, 0]);
    }
  });
});

describe("getRouteSeo — card resolution", () => {
  it("returns the route's own card", () => {
    expect(getRouteSeo("/governance").image).toBe(OG_CARD.governance);
    expect(getRouteSeo("/roadmap/graph").image).toBe(OG_CARD.roadmapGraph);
  });

  it("shares the DRep card between the explorer and a single DRep", () => {
    expect(getRouteSeo("/governance/drep/[id]").image).toBe(
      getRouteSeo("/governance/drep").image,
    );
  });

  it("falls back to the site card for routes without one", () => {
    expect(getRouteSeo("/").image).toBe(OG_IMAGE_PATH);
    expect(getRouteSeo("/wallets/[wallet]").image).toBe(OG_IMAGE_PATH);
  });
});

describe("ogImageUrl", () => {
  it("returns an absolute, version-tagged URL", () => {
    const url = ogImageUrl(OG_CARD.blog);
    expect(url).toMatch(/^https?:\/\//);
    expect(url).toContain(OG_CARD.blog);
    expect(url.endsWith(`?v=${OG_IMAGE_VERSION}`)).toBe(true);
  });

  it("defaults to the site card", () => {
    expect(ogImageUrl()).toContain(OG_IMAGE_PATH);
  });

  it("appends rather than replaces an existing query string", () => {
    expect(ogImageUrl("/og/blog.png?foo=1")).toContain(
      `?foo=1&v=${OG_IMAGE_VERSION}`,
    );
  });
});
