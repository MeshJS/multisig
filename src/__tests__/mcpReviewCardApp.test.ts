import { describe, expect, it } from "@jest/globals";

import {
  MCP_APPS_PROTOCOL_VERSION,
  REVIEW_CARD_HTML,
  REVIEW_CARD_MIME_TYPE,
  REVIEW_CARD_RESOURCE_META,
  REVIEW_CARD_RESOURCE_URI,
  reviewCardResourceContents,
} from "@/lib/mcp/apps/review-card";
import { MCP_TOOLS } from "@/lib/mcp/tools";

/**
 * The MCP App view is a hand-rolled implementation of the ext-apps bridge.
 * These tests pin the parts of the contract a host actually checks — the
 * URI scheme, the MIME type, the handshake and notification names — and the
 * sandbox constraints the page must live within (no external loads).
 */

describe("review-card MCP App resource", () => {
  it("uses the ui:// scheme and the mcp-app HTML profile", () => {
    expect(REVIEW_CARD_RESOURCE_URI).toMatch(/^ui:\/\//);
    expect(REVIEW_CARD_MIME_TYPE).toBe("text/html;profile=mcp-app");
    const { contents } = reviewCardResourceContents();
    expect(contents).toHaveLength(1);
    expect(contents[0]).toMatchObject({
      uri: REVIEW_CARD_RESOURCE_URI,
      mimeType: REVIEW_CARD_MIME_TYPE,
      _meta: REVIEW_CARD_RESOURCE_META,
    });
    expect(contents[0]!.text.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("declares no network or external asset origins", () => {
    expect(REVIEW_CARD_RESOURCE_META.ui.csp).toEqual({
      connectDomains: [],
      resourceDomains: [],
      frameDomains: [],
    });
    // Self-contained: nothing loaded from a URL, nothing fetched.
    expect(REVIEW_CARD_HTML).not.toMatch(/<script[^>]+src=/i);
    expect(REVIEW_CARD_HTML).not.toMatch(/<link[^>]+href=/i);
    expect(REVIEW_CARD_HTML).not.toMatch(/\bfetch\(/);
    expect(REVIEW_CARD_HTML).not.toMatch(/https?:\/\//);
  });

  it("speaks the ext-apps bridge: handshake, result delivery, confirm, sizing", () => {
    for (const method of [
      "ui/initialize",
      "ui/notifications/initialized",
      "ui/notifications/tool-result",
      "ui/notifications/tool-cancelled",
      "ui/notifications/host-context-changed",
      "ui/resource-teardown",
      "ui/notifications/size-changed",
      "ui/open-link",
      "ui/update-model-context",
      "tools/call",
    ]) {
      expect(REVIEW_CARD_HTML).toContain(`"${method}"`);
    }
    expect(REVIEW_CARD_HTML).toContain(`"${MCP_APPS_PROTOCOL_VERSION}"`);
    // Only ever calls the propose tool, with the token the preview minted.
    const calls = REVIEW_CARD_HTML.match(/name: "([a-z_]+)", arguments/g) ?? [];
    expect(calls).toEqual(['name: "transaction_propose", arguments']);
    expect(REVIEW_CARD_HTML).toContain("draftToken: state.draftToken");
    // Inbound messages are accepted from the parent frame only.
    expect(REVIEW_CARD_HTML).toContain("event.source !== window.parent");
  });

  it("renders the tool's image block as a data: URL", () => {
    expect(REVIEW_CARD_HTML).toContain('src="data:');
    expect(REVIEW_CARD_HTML).toContain('type === "image"');
  });
});

describe("tools that render the app", () => {
  it("are exactly the three review tools", () => {
    const withUi = MCP_TOOLS.filter((t) => t.uiResourceUri).map((t) => t.name);
    expect(withUi).toEqual([
      "transaction_preview",
      "transaction_propose",
      "multisig_review_pending_transaction",
    ]);
    for (const tool of MCP_TOOLS) {
      if (tool.uiResourceUri) expect(tool.uiResourceUri).toBe(REVIEW_CARD_RESOURCE_URI);
    }
  });
});
