import { describe, expect, it } from "@jest/globals";
import { isResourceActive, resourceLinks } from "@/data/learn-help";
import { publicRoutes } from "@/data/public-routes";
import { isLightHref } from "@/lib/wallet-runtime";

describe("Learn & Help destinations", () => {
  it("contains every required public destination exactly once", () => {
    const links = Object.values(resourceLinks);
    expect(links.map((link) => link.href).sort()).toEqual(
      [
        "/about",
        "/getting-started",
        "/features",
        "/about#developers-and-bots",
        "/docs/mcp",
        "/bot-setup",
        "/api-docs",
        "/dapps",
        "/verify",
        "/governance",
        "/blog",
        "/roadmap",
        "/roadmap/graph",
        "/vault",
      ].sort(),
    );
    for (const link of links)
      expect(publicRoutes).toContain(link.href.split("#")[0]);
    // Light destinations are prefetched; wallet destinations are not, because
    // prefetching one downloads the Cardano stack (see isLightHref).
    // /api-docs became light in #449 — its token generator loads lazily.
    expect(isLightHref("/getting-started")).toBe(true);
    expect(isLightHref("/api-docs")).toBe(true);
    expect(isLightHref("/dapps")).toBe(false);
  });
  it("distinguishes fragment and nested destinations", () => {
    expect(
      isResourceActive("/about", "/about?from=nav#developers-and-bots"),
    ).toBe(false);
    expect(
      isResourceActive(
        "/about#developers-and-bots",
        "/about?from=nav#developers-and-bots",
      ),
    ).toBe(true);
    expect(isResourceActive("/roadmap", "/roadmap/graph")).toBe(false);
    expect(isResourceActive("/roadmap/graph", "/roadmap/graph")).toBe(true);
    expect(isResourceActive("/blog", "/blog/a-post?from=nav")).toBe(true);
    expect(isResourceActive("/features", "/wallets/abc")).toBe(false);
  });
});
