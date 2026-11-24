import { describe, expect, it } from "@jest/globals";
import { legacyResourceDestination } from "@/lib/resource-links";
import { publicRoutes } from "@/data/public-routes";
import { isLightHref } from "@/lib/wallet-runtime";

describe("resource routes", () => {
  it.each([
    ["/#connect-mcp", "/docs/mcp"],
    ["/about#connect-mcp", "/docs/mcp"],
    ["/?source=a%26b#connect-mcp", "/docs/mcp?source=a%26b"],
    ["/#developers-and-bots", "/about#developers-and-bots"],
    [
      "/?source=help#developers-and-bots",
      "/about?source=help#developers-and-bots",
    ],
  ])("migrates %s without losing queries", (input, expected) => {
    expect(legacyResourceDestination(input)).toBe(expected);
    expect(legacyResourceDestination(expected)).toBeNull();
  });
  it.each([
    "/",
    "/?source=help",
    "/#other",
    "/wallets#connect-mcp",
    "/about#developers-and-bots",
  ])("leaves ordinary navigation unchanged: %s", (input) => {
    expect(legacyResourceDestination(input)).toBeNull();
  });
  it.each(["/about", "/docs/mcp"])(
    "keeps %s public and lightweight",
    (path) => {
      expect(publicRoutes).toContain(path);
      expect(isLightHref(path)).toBe(true);
    },
  );
});
