import { describe, expect, it } from "@jest/globals";

import { MAX_META_TAG_CHARS, readMetaTags, readTitle } from "@/lib/html/metaTags";

// readMetaTags parses <meta> tags from pages fetched off the internet on behalf
// of anonymous callers, so it has to be cheap on hostile input as well as
// right on ordinary pages.

describe("readMetaTags", () => {
  it("keys property= and name= tags separately", () => {
    const tags = readMetaTags(
      `<meta property="og:title" content="OG"><meta name="title" content="Plain">`,
    );
    expect(tags.get("property:og:title")).toBe("OG");
    expect(tags.get("name:title")).toBe("Plain");
  });

  it("is case-insensitive in tag and attribute names, and keeps the value's case", () => {
    const tags = readMetaTags(`<META Property='OG:Image' CONTENT='https://x.test/A.png'/>`);
    expect(tags.get("property:og:image")).toBe("https://x.test/A.png");
  });

  it("keeps the first non-empty value for a key", () => {
    const tags = readMetaTags(
      `<meta property="og:title" content=""><meta property="og:title" content="First"><meta property="og:title" content="Second">`,
    );
    expect(tags.get("property:og:title")).toBe("First");
  });

  it("keeps an apostrophe inside a double-quoted value", () => {
    const tags = readMetaTags(`<meta name="description" content="It's here">`);
    expect(tags.get("name:description")).toBe("It's here");
  });

  it("ignores tags that only start with 'meta'", () => {
    const tags = readMetaTags(`<metadata property="og:title" content="no">`);
    expect(tags.size).toBe(0);
  });

  it("skips a tag longer than the cap and carries on after it", () => {
    const long = `<meta property="og:title" content="${"x".repeat(MAX_META_TAG_CHARS)}">`;
    const tags = readMetaTags(`${long}<meta property="og:title" content="Short">`);
    expect(tags.get("property:og:title")).toBe("Short");
  });

  it("does not end a tag at a > inside a quoted value", () => {
    const tags = readMetaTags(`<meta property="og:title" content="A -> B">`);
    expect(tags.get("property:og:title")).toBe("A -> B");
  });

  it("reads unquoted values", () => {
    expect(readMetaTags(`<meta name=description content=Plain>`).get("name:description")).toBe(
      "Plain",
    );
  });

  it("drops a tag with an unclosed quote and still finds a later one", () => {
    const tags = readMetaTags(
      `<meta property="og:title" content="never closed>${" ".repeat(MAX_META_TAG_CHARS)}<meta property="og:title" content="Later">`,
    );
    expect(tags.get("property:og:title")).toBe("Later");
  });

  // Each of these shapes costs seconds per MiB for a scanner that rescans
  // (whole-document regexes, an unanchored attribute regex, or resuming
  // inside a dropped tag). Linear code does any of them in milliseconds, so
  // a one-second ceiling leaves a wide margin for slow CI machines.
  const MiB = 1024 * 1024;
  const fill = (unit: string) => unit.repeat(Math.floor(MiB / unit.length));
  it.each([
    ["unclosed openings", fill("<meta " + "a".repeat(50))],
    ["long attribute names with no =", fill(`<meta ${"a".repeat(MAX_META_TAG_CHARS - 10)}>`)],
    ["unclosed quotes between closed tags", fill(`<meta a="x>`)],
    ["many short valid tags", fill(`<meta property="og:title" content="x" ${"a=' ".repeat(8)}>`)],
  ])("stays linear on 1 MiB of %s", (_shape, html) => {
    const started = Date.now();
    readMetaTags(html);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("readTitle", () => {
  it("reads the first <title> text", () => {
    expect(readTitle("<head><TITLE>Hello</TITLE></head>")).toBe("Hello");
  });

  it("is undefined when there is no title text", () => {
    expect(readTitle("<title></title>")).toBeUndefined();
  });
});
