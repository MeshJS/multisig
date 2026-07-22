import React from "react";
import ReactDOMServer from "react-dom/server";

import SeoFallback from "@/components/ui/seo-fallback";
import { buildJsonLd, DEFAULT_DESCRIPTION, INDEXABLE_ROUTES } from "@/lib/seo";
import { buildLlmsTxt } from "@/pages/llms.txt";

/**
 * These guard the "even a no-JS fetcher sees real content" behaviour: the SPA
 * renders an empty body server-side, so SeoFallback (in <noscript>) and the
 * server-rendered JSON-LD are what crawlers / LLM fetchers actually read.
 */
describe("SeoFallback — no-JS crawler/LLM content fallback", () => {
  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(SeoFallback),
  );

  it("is wrapped in <noscript> so JS-enabled visitors never render it", () => {
    expect(html.startsWith("<noscript>")).toBe(true);
    expect(html.endsWith("</noscript>")).toBe(true);
  });

  it("exposes the product headline and description as readable text", () => {
    expect(html).toContain("Multisig Security");
    expect(html).toContain(DEFAULT_DESCRIPTION);
  });

  it("links to every public surface", () => {
    for (const path of [
      "/features",
      "/governance",
      "/governance/drep",
      "/api-docs",
      "/dapps",
      "/wallets/import-wallet",
    ]) {
      // Absolute canonical URLs, so each path appears as an href suffix.
      expect(html).toContain(`${path}"`);
    }
  });

  it("surfaces the bot-API entry points for AI agents", () => {
    for (const path of ["/llms.txt", "/api/swagger", "/api/skill"]) {
      expect(html).toContain(`${path}"`);
    }
  });
});

describe("buildLlmsTxt — /llms.txt for AI agents", () => {
  const txt = buildLlmsTxt();

  it("starts with an llms.txt H1 + summary blockquote", () => {
    expect(txt.startsWith("# ")).toBe(true);
    expect(txt).toContain(`> ${DEFAULT_DESCRIPTION}`);
  });

  it("points to the machine-readable spec and downloadable skill", () => {
    expect(txt).toContain("/api/swagger");
    expect(txt).toContain("/api/skill");
  });

  it("documents the 4-step bot onboarding and bearer auth", () => {
    expect(txt).toContain("Authorization: Bearer");
    for (const ep of [
      "/api/v1/botRegister",
      "/api/v1/botClaim",
      "/api/v1/botPickupSecret",
      "/api/v1/botAuth",
    ]) {
      expect(txt).toContain(ep);
    }
  });

  it("is listed in the sitemap route set", () => {
    expect(INDEXABLE_ROUTES.map((r) => r.path)).toContain("/llms.txt");
  });
});

describe("buildJsonLd — structured data for the initial HTML", () => {
  const types = (pathname: string) =>
    buildJsonLd(pathname).map((entry) => entry["@type"] as string);

  it("emits Organization + WebSite site-wide", () => {
    expect(types("/features")).toEqual(["Organization", "WebSite"]);
  });

  it("adds SoftwareApplication only on the home page", () => {
    expect(types("/")).toContain("SoftwareApplication");
    expect(types("/features")).not.toContain("SoftwareApplication");
  });
});
