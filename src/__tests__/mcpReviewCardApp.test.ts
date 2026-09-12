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

/**
 * Layout and theming follow the MCP Apps spec's host-context contract and
 * Anthropic's design guidelines for inline apps. The suite has no DOM, so
 * these pin the mechanisms in the source: how size is measured and reported,
 * what host context is applied, and the CSS invariants that keep scrollbars
 * away and controls off the edges.
 */
describe("review-card MCP App layout and theming", () => {
  it("is borderless and pads itself", () => {
    // Claude web is borderless by default and adds no padding; the view owns
    // its gutters (16px + safeAreaInsets) and paints no background.
    expect(REVIEW_CARD_RESOURCE_META.ui.prefersBorder).toBe(false);
    expect(REVIEW_CARD_HTML).toContain('<meta name="color-scheme" content="light dark">');
    expect(REVIEW_CARD_HTML).toContain("background: transparent");
    expect(REVIEW_CARD_HTML).toContain("box-sizing: border-box");
    expect(REVIEW_CARD_HTML).toContain("overflow-x: hidden");
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(REVIEW_CARD_HTML).toContain(`calc(16px + var(--inset-${side}))`);
    }
    expect(REVIEW_CARD_HTML).toContain("min-height: 44px"); // tap target
  });

  it("measures size the way the ext-apps SDK does and pins the document height", () => {
    // Width is the viewport, never the scroll width (the SDK refuses to report
    // fit-content width); height is the max-content bounding height.
    expect(REVIEW_CARD_HTML).not.toContain("scrollWidth");
    expect(REVIEW_CARD_HTML).not.toContain("scrollHeight");
    expect(REVIEW_CARD_HTML).toContain("var width = Math.ceil(window.innerWidth);");
    expect(REVIEW_CARD_HTML).toContain('notify("ui/notifications/size-changed", { width: width, height: height })');
    expect(REVIEW_CARD_HTML).toContain('html.style.height = "max-content"');
    expect(REVIEW_CARD_HTML).toContain("html.getBoundingClientRect().height");
    expect(REVIEW_CARD_HTML).toContain("requestAnimationFrame(measure)");
    // claude-ai-mcp #69: the host reads the DOM height itself, so pin it —
    // synchronously after every DOM mutation, never as 0px from a hidden
    // frame; a fixed host height means 100vh per the spec.
    expect(REVIEW_CARD_HTML).toContain('fixedHeight() ? "100vh" : height + "px"');
    expect(REVIEW_CARD_HTML).toContain('if (!height) { html.style.height = ""; return; }');
    expect(REVIEW_CARD_HTML).toContain('html.classList.remove("compact");\n    root.innerHTML = markup;\n    measureNow();');
    // Under a host height cap the drawn card tightens its spacing (one-way per
    // render) before the host has to scroll; the document is still never clamped.
    expect(REVIEW_CARD_HTML).toContain('if (cap && height > cap && !html.classList.contains("compact"))');
    expect(REVIEW_CARD_HTML).toContain("html.compact .card { gap: 8px; padding: 12px; }");
    expect(REVIEW_CARD_HTML).toContain("el.textContent = text; measureNow();");
    // An advertised maxHeight is never applied to the document (inline cards
    // auto-fit); the PNG is scaled to fit inside it instead, with a floor.
    expect(REVIEW_CARD_HTML).not.toContain("html.style.maxHeight");
    expect(REVIEW_CARD_HTML).not.toContain("html.style.maxWidth");
    // width:100% (not auto) keeps the IHDR-reserved box before decode; the cap
    // is a max-width derived from the aspect ratio, never a max-height.
    expect(REVIEW_CARD_HTML).toContain("width: 100%; max-width: var(--img-max-w, 100%); height: auto;");
    expect(REVIEW_CARD_HTML).not.toContain("max-height:");
    expect(REVIEW_CARD_HTML).toContain('typeof cd.maxHeight === "number"');
    expect(REVIEW_CARD_HTML).toContain('html.style.setProperty("--img-max-w", next + "px")');
    expect(REVIEW_CARD_HTML).toContain("Math.max(IMG_MIN_HEIGHT, cap - chrome)");
    expect(REVIEW_CARD_HTML).toContain("if (fitImage(height)) height = Math.ceil(html.getBoundingClientRect().height);");
    expect(REVIEW_CARD_HTML).toContain("ro.observe(html)");
    expect(REVIEW_CARD_HTML).toContain("ro.observe(document.body)");
    // The PNG box is reserved before decode, and re-measured after it.
    expect(REVIEW_CARD_HTML).toContain('"IHDR"');
    expect(REVIEW_CARD_HTML).toContain("img.decode()");
    expect(REVIEW_CARD_HTML).toContain("whenDecoded(img).then(sizeChanged)");
  });

  it("applies the host context: theme, style variables, insets, dimensions", () => {
    expect(REVIEW_CARD_HTML).toContain("html.style.colorScheme = ctx.theme");
    expect(REVIEW_CARD_HTML).toContain("ctx.styles.variables");
    expect(REVIEW_CARD_HTML).toContain("html.style.setProperty(k, String(vars[k]))");
    expect(REVIEW_CARD_HTML).toContain("ctx.safeAreaInsets");
    expect(REVIEW_CARD_HTML).toContain("ctx.containerDimensions");
    // The debugging-era diagnostics readout is gone from the user-facing card.
    expect(REVIEW_CARD_HTML).not.toContain("Diagnostics");
    expect(REVIEW_CARD_HTML).not.toContain("hostCapabilities");
  });

  it("draws the card from the structured summary when no image block is attached", () => {
    // html mode (the default): the tool result carries no PNG, so the view
    // renders the same sections and strings as src/lib/tx-review/card.ts
    // from structuredContent.summary. The image path stays for card: "image".
    expect(REVIEW_CARD_HTML).toContain("function cardMarkup(s)");
    expect(REVIEW_CARD_HTML).toContain("} else if (summary.wallet) {\n      markup += cardMarkup(summary);");
    for (const literal of [
      "UNSIGNED PREVIEW",
      '"PENDING · " + signed + " OF " + threshold.required + " SIGNED"',
      "Unknown address",
      "no amount",
      '"Change to this wallet"',
      "Nothing has been signed or broadcast. Signers approve in the Mesh Multisig app.",
      "Nothing is broadcast until the threshold is met.",
      'esc("Warning: " + warnings[w])',
      'esc("Tx hash " + (s.txHash || ""))',
      "s.recipients",
      "s.actions",
      "rationale.status === \"will-publish-on-confirm\"",
    ]) {
      expect(REVIEW_CARD_HTML).toContain(literal);
    }
    // Nothing from the summary reaches the DOM unescaped: every interpolation
    // of a summary field is wrapped in esc(...).
    const cardSource = REVIEW_CARD_HTML.slice(
      REVIEW_CARD_HTML.indexOf("function cardMarkup(s)"),
      REVIEW_CARD_HTML.indexOf("function render()"),
    );
    for (const field of ["wallet.name", "r.label", "r.address", "a.label", "a.title", "a.detail", "s.description", "s.metadataMessage", "warnings[w]"]) {
      expect(cardSource).toMatch(new RegExp(`esc\\([^;]*${field.replace(/[.[\]]/g, "\\$&")}`));
    }
    // Layout: no fixed sizes on the drawn card; rows wrap and long values break.
    expect(REVIEW_CARD_HTML).toContain(".card { display: flex; flex-direction: column; gap: 12px; min-width: 0;");
    expect(REVIEW_CARD_HTML).toContain("overflow-wrap: anywhere; }");
    expect(REVIEW_CARD_HTML).toContain(".card .line { display: flex; flex-wrap: wrap;");
    expect(REVIEW_CARD_HTML).toMatch(/var\(--color-text-info, /);
    expect(REVIEW_CARD_HTML).toMatch(/var\(--color-text-warning, /);
  });

  it("uses Claude's style tokens with fallbacks", () => {
    for (const token of [
      "--color-text-primary",
      "--color-text-secondary",
      "--color-background-secondary",
      "--color-border-secondary",
      "--color-text-success",
      "--color-text-danger",
      "--border-radius-md",
      "--font-text-sm-size",
      "--font-weight-semibold",
    ]) {
      expect(REVIEW_CARD_HTML).toMatch(new RegExp(`var\\(${token}, `));
    }
    // Host fonts are not loaded (zero-origin CSP); the system stack stays.
    expect(REVIEW_CARD_HTML).not.toContain("--font-sans");
    expect(REVIEW_CARD_HTML).toContain("font-family: system-ui");
  });
});

describe("tools that render the app", () => {
  it("are exactly the review tools", () => {
    // task_prepare_payout returns the same card and draftToken shape as
    // transaction_preview, so the view's Confirm button works for it unchanged.
    const withUi = MCP_TOOLS.filter((t) => t.uiResourceUri).map((t) => t.name);
    expect(withUi).toEqual([
      "transaction_preview",
      "transaction_propose",
      "multisig_review_pending_transaction",
      "task_prepare_payout",
    ]);
    for (const tool of MCP_TOOLS) {
      if (tool.uiResourceUri) expect(tool.uiResourceUri).toBe(REVIEW_CARD_RESOURCE_URI);
    }
  });
});
