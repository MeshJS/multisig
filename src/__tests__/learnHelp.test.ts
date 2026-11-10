import { describe, expect, it } from "@jest/globals";
import { isResourceActive, learnHelpGroups } from "@/data/learn-help";
import { publicRoutes } from "@/data/public-routes";
import { isLightHref } from "@/lib/wallet-runtime";

describe("Learn & Help destinations", () => {
  it("contains every required public destination exactly once", () => {
    const links = learnHelpGroups.flatMap((group) => group.links);
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
        "/blog",
        "/roadmap",
        "/roadmap/graph",
        "/vault",
      ].sort(),
    );
    for (const link of links)
      expect(publicRoutes).toContain(link.href.split("#")[0]);
    expect(isLightHref("/getting-started")).toBe(true);
    expect(isLightHref("/api-docs")).toBe(false);
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
