/**
 * The review-card MCP App.
 *
 * MCP Apps (extension `io.modelcontextprotocol/ui`, spec 2026-01-26) let a
 * tool point at an HTML resource that the host renders inline in the
 * conversation, in a sandboxed iframe, when the tool is called. That is the
 * only way to put the review card in front of the user without them
 * expanding the tool-call panel: a tool's image block is otherwise shown
 * collapsed by the Claude app, and the model cannot re-emit it.
 *
 * The view is one self-contained HTML document — inline script and styles,
 * nothing fetched — so it runs under the extension's default CSP
 * (`script-src 'self' 'unsafe-inline'`, `img-src 'self' data:`,
 * `connect-src 'none'`). It talks to the host over JSON-RPC 2.0 postMessage
 * exactly as the spec describes, hand-rolled rather than via
 * `@modelcontextprotocol/ext-apps` (which peers on SDK v1 and would have to
 * be bundled into the page).
 *
 * Two ways to show the card, chosen by the tool's `card` option:
 *  - `html` (default): no image block; `cardMarkup()` draws the card from
 *    `structuredContent.summary` — the same sections and strings as the PNG
 *    (`src/lib/tx-review/card.ts`) — so it reflows to the frame's width and
 *    takes the host's theme. No raster to fit, so no sizing trouble.
 *  - `image`: the tool result carries the PNG, which is shown as a data: URL
 *    and scaled to fit the host's height cap.
 *
 * What the view does:
 *  - handshake: `ui/initialize` → `ui/notifications/initialized`
 *  - on `ui/notifications/tool-result`: show the card (drawn, or the image)
 *    and the summary facts; for a preview, offer a **Confirm** button
 *  - Confirm → `tools/call transaction_propose { draftToken }` through the
 *    host; the human's click is the confirmation the design requires
 *  - after a successful propose: show the final card, an "Open in app" link
 *    (`ui/open-link`), and tell the model via `ui/update-model-context`
 *  - sizing the SDK way after every render: rAF-debounced `max-content`
 *    bounding height, `window.innerWidth` (never `scrollWidth`), and a
 *    `ui/notifications/size-changed` only when the numbers change
 *
 * Sizing and layout follow the spec's host-context contract and Anthropic's
 * design guidelines for inline apps (auto-fit height, no nested or horizontal
 * scrolling, generous padding, `safeAreaInsets` applied as root padding, host
 * style tokens with fallbacks, transparent background, explicit
 * `prefersBorder`). Two things are specific to claude.ai: it does not act on
 * `size-changed` and instead reads the iframe document's height itself, and
 * it can snapshot that early (anthropics/claude-ai-mcp #69). So the view
 * reserves the PNG's box from its IHDR dimensions before the image decodes
 * and pins `documentElement.style.height` after every measurement.
 *
 * Host fonts are deliberately not loaded: `--font-sans` resolves to Anthropic
 * Sans, whose `@font-face` needs `assets.claude.ai` in the CSP, and the view
 * keeps a zero-origin CSP. The system stack is the better fallback.
 *
 * Text-only clients are unaffected: the tool result still carries the text
 * block (and the image block on request), and the resource is never read.
 */

export const REVIEW_CARD_RESOURCE_URI = "ui://mesh-multisig/review-card";
export const REVIEW_CARD_MIME_TYPE = "text/html;profile=mcp-app";
export const MCP_APPS_PROTOCOL_VERSION = "2026-01-26";

/**
 * Resource-level UI metadata: no network, no external assets, borderless.
 * Claude web renders borderless by default and adds no padding of its own, so
 * the view pads itself (16px plus `safeAreaInsets`) and paints no background.
 */
export const REVIEW_CARD_RESOURCE_META = {
  ui: {
    prefersBorder: false,
    csp: { connectDomains: [], resourceDomains: [], frameDomains: [] },
  },
} as const;

export const REVIEW_CARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Transaction review card</title>
<style>
  /* Host tokens first (Claude's values use light-dark(), resolved by the
     color-scheme set on <html>), falling back to a light/dark palette of our
     own when the host sends none. */
  :root { color-scheme: light dark;
    --fb-fg: #0f172a; --fb-muted: #64748b; --fb-panel: #f1f5f9; --fb-border: #e2e8f0;
    --fb-ok: #16a34a; --fb-ok-bg: #f0fdf4; --fb-err: #dc2626; --fb-err-bg: #fef2f2;
    --fb-info: #2563eb; --fb-warn: #b45309;
    --inset-top: 0px; --inset-right: 0px; --inset-bottom: 0px; --inset-left: 0px; }
  html[data-theme="dark"] { --fb-fg: #f1f5f9; --fb-muted: #94a3b8; --fb-panel: #111a2e; --fb-border: #1f2a44; --fb-ok-bg: #052e16; --fb-err-bg: #450a0a; --fb-info: #60a5fa; --fb-warn: #fbbf24; }
  :root {
    --fg: var(--color-text-primary, var(--fb-fg));
    --muted: var(--color-text-secondary, var(--fb-muted));
    --panel: var(--color-background-secondary, var(--fb-panel));
    --border: var(--color-border-secondary, var(--fb-border));
    --ok: var(--color-text-success, var(--fb-ok)); --ok-border: var(--color-border-success, var(--fb-ok)); --ok-bg: var(--color-background-success, var(--fb-ok-bg));
    --err: var(--color-text-danger, var(--fb-err)); --err-border: var(--color-border-danger, var(--fb-err)); --err-bg: var(--color-background-danger, var(--fb-err-bg));
    --info: var(--color-text-info, var(--fb-info)); --warn: var(--color-text-warning, var(--fb-warn));
    --accent: #f59e0b; --accent-ink: #1f1300; /* brand CTA colour, deliberately not a host token */
    --radius-md: var(--border-radius-md, 8px); --radius-lg: var(--border-radius-lg, 10px);
    --text-lg: var(--font-text-lg-size, 18px); --text-sm: var(--font-text-sm-size, 14px); --text-xs: var(--font-text-xs-size, 12px);
    --semibold: var(--font-weight-semibold, 600);
  }
  *, *::before, *::after { box-sizing: border-box; }
  html { overflow-x: hidden; overflow-y: auto; }
  html, body { margin: 0; padding: 0; max-width: 100%; background: transparent; color: var(--fg); font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: var(--text-sm); line-height: 1.45; }
  #root { display: flex; flex-direction: column; gap: 12px; min-width: 0; padding: calc(16px + var(--inset-top)) calc(16px + var(--inset-right)) calc(16px + var(--inset-bottom)) calc(16px + var(--inset-left)); }
  #status:empty { display: none; } /* the empty placeholder must not cost a gap (img is :empty too, so scope it) */
  /* width:100% + the IHDR width/height attributes give the box its height before
     decode. --img-max-w (set by fitImage) narrows the PNG, centred, when the host
     advertises a maxHeight the full-width card would exceed, so the frame never
     scrolls; a max-height would distort or (with width:auto) lose the pre-decode box. */
  img.card { display: block; width: 100%; max-width: var(--img-max-w, 100%); height: auto; margin: 0 auto; border-radius: var(--radius-lg); border: 1px solid var(--border); }
  /* The drawn card (html mode): no fixed widths or heights anywhere, every
     row wraps, long strings break, colours come from the host tokens. */
  .card { display: flex; flex-direction: column; gap: 12px; min-width: 0; padding: 16px; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow-wrap: anywhere; }
  .card .head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 8px 12px; }
  .card .name { font-size: var(--text-lg); font-weight: var(--semibold); }
  .card .sub, .card .addr, .card .muted, .card .hash, .card .label { color: var(--muted); font-size: var(--text-xs); }
  .card .label { text-transform: uppercase; letter-spacing: .08em; }
  .card .pill { white-space: nowrap; font-size: var(--text-xs); font-weight: var(--semibold); letter-spacing: .05em; padding: 4px 10px; border-radius: 999px; background: var(--accent); color: var(--accent-ink); }
  .card .pill.done { background: var(--ok-bg); color: var(--ok); border: 1px solid var(--ok-border); }
  .card .desc { padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); }
  .card .section { display: flex; flex-direction: column; gap: 4px; }
  .card .line { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 4px 16px; padding: 8px 0; border-top: 1px solid var(--border); }
  .card .line.col { flex-direction: column; }
  .card .who, .card .amounts { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .card .amounts { margin-left: auto; text-align: right; }
  .card .strong { font-weight: var(--semibold); }
  .card .stats { display: flex; flex-wrap: wrap; gap: 12px 24px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); }
  .card .stat { display: flex; flex-direction: column; gap: 2px; min-width: 96px; }
  .card .ok, .card .cert { color: var(--ok); }
  .card .err { color: var(--err); }
  .card .warn { color: var(--warn); }
  .card .vote { color: var(--info); }
  .card .hash { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .card .banner { padding: 10px 12px; border-radius: var(--radius-md); background: var(--accent); color: var(--accent-ink); font-weight: var(--semibold); }
  /* Denser spacing, switched on by measure() only when the host caps the
     frame's height below the card, so the whole card shows before the host
     has to scroll (ChatGPT sizes the inline frame to a viewport-derived cap). */
  html.compact #root { gap: 8px; }
  html.compact .card { gap: 8px; padding: 12px; }
  html.compact .card .line { padding: 5px 0; }
  html.compact .card .stats { padding: 6px 10px; gap: 8px 20px; }
  html.compact .card .desc, html.compact .card .banner { padding: 6px 10px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
  .facts { color: var(--muted); overflow-wrap: anywhere; }
  .facts b { color: var(--fg); font-weight: var(--semibold); }
  button { font: inherit; font-weight: var(--semibold); min-height: 44px; max-width: 100%; padding: 10px 16px; border-radius: var(--radius-md); border: 1px solid var(--border); background: var(--panel); color: var(--fg); cursor: pointer; }
  button.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; }
  button:disabled { opacity: .6; cursor: default; }
  .status { padding: 10px 12px; border-radius: var(--radius-md); background: var(--panel); border: 1px solid var(--border); overflow-wrap: anywhere; }
  .status.ok { border-color: var(--ok-border); background: var(--ok-bg); }
  .status.err { border-color: var(--err-border); background: var(--err-bg); color: var(--err); }
  .hint { color: var(--muted); font-size: var(--text-xs); }
  pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-size: var(--text-xs); color: var(--muted); }
</style>
</head>
<body>
<div id="root"><div class="hint">Waiting for the transaction…</div></div>
<script>
(function () {
  "use strict";
  var PROTOCOL_VERSION = "${MCP_APPS_PROTOCOL_VERSION}";
  var APP_VERSION = "2.0.0";
  var root = document.getElementById("root");
  var html = document.documentElement;
  var nextId = 1;
  var pending = {}; // id -> {resolve, reject}
  var state = { kind: null, draftToken: null, result: null, hostContext: null, busy: false };

  function post(message) {
    // "*" per the spec's reference implementation; inbound messages are
    // accepted only from window.parent.
    window.parent.postMessage(message, "*");
  }
  function request(method, params) {
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      post({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    });
  }
  function notify(method, params) {
    post({ jsonrpc: "2.0", method: method, params: params || {} });
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var msg = event.data;
    if (!msg || msg.jsonrpc !== "2.0") return;
    if (msg.id !== undefined && msg.method === undefined) {
      var p = pending[msg.id];
      if (!p) return;
      delete pending[msg.id];
      if (msg.error) p.reject(msg.error); else p.resolve(msg.result);
      return;
    }
    switch (msg.method) {
      case "ui/notifications/tool-input":
      case "ui/notifications/tool-input-partial":
        break; // the arguments are not needed to render a result
      case "ui/notifications/tool-result":
        state.result = msg.params || {};
        render();
        break;
      case "ui/notifications/tool-cancelled":
        show('<div class="status err">The tool call was cancelled' + (msg.params && msg.params.reason ? ": " + esc(msg.params.reason) : "") + ".</div>");
        break;
      case "ui/notifications/host-context-changed":
        applyHostContext(msg.params || {});
        break;
      case "ui/resource-teardown":
        post({ jsonrpc: "2.0", id: msg.id, result: {} });
        break;
      default:
        if (msg.id !== undefined) {
          post({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
        }
    }
  });

  // Mirrors the SDK's applyDocumentTheme / applyHostStyleVariables and the
  // spec's containerDimensions snippet; insets become root padding via CSS vars.
  function applyHostContext(ctx) {
    state.hostContext = Object.assign({}, state.hostContext || {}, ctx);
    if (ctx.theme) { html.setAttribute("data-theme", ctx.theme); html.style.colorScheme = ctx.theme; }
    var vars = ctx.styles && ctx.styles.variables;
    if (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k) && k.indexOf("--") === 0) html.style.setProperty(k, String(vars[k]));
      }
    }
    var insets = ctx.safeAreaInsets;
    if (insets) {
      ["top", "right", "bottom", "left"].forEach(function (side) {
        html.style.setProperty("--inset-" + side, Math.max(0, Number(insets[side]) || 0) + "px");
      });
    }
    var cd = ctx.containerDimensions;
    if (cd) {
      // Fixed dimensions are honoured (100vh in measure(), 100vw here).
      // maxHeight/maxWidth are never applied to the document: Anthropic's
      // inline guideline is auto-fit height with no nested scrolling, and
      // clamping to an advertised maxHeight is the suspected cause of the
      // short, scrolling frame seen in claude.ai. Instead measure() scales the
      // PNG so the auto-fit card stays within the cap (fitImage).
      html.style.width = typeof cd.width === "number" ? "100vw" : "";
    }
    sizeChanged(); // theme, insets and dimensions can all change layout
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Sizing: the ext-apps SDK's measurement (max-content bounding height,
  // innerWidth, rAF-debounced, observe html + body), plus the claude-ai-mcp
  // #69 workaround of pinning the document height so a host that reads the
  // DOM instead of listening for size-changed sees the right number.
  var last = { width: 0, height: 0 };
  var raf = 0;
  var IMG_MIN_HEIGHT = 160; // a bogus tiny cap can never collapse the card
  function fixedHeight() {
    var cd = state.hostContext && state.hostContext.containerDimensions;
    return !!(cd && typeof cd.height === "number");
  }
  // The tallest the host will let the frame be, or null when it auto-fits.
  function heightCap() {
    var cd = state.hostContext && state.hostContext.containerDimensions;
    if (!cd) return null;
    if (typeof cd.maxHeight === "number" && cd.maxHeight > 0) return cd.maxHeight;
    if (typeof cd.height === "number" && cd.height > 0) return cd.height;
    return null;
  }
  // Fit inside the cap by scaling the PNG, never by clamping the document
  // (clamping is what produced the short, scrolling frame in claude.ai). The
  // chrome around the image (padding, facts, button) is a fixed cost, so the
  // image gets whatever height is left, expressed as a max-width through its
  // aspect ratio so the pre-decode box and the aspect survive; when the
  // full-width card already fits, the cap exceeds the width and has no
  // effect. Returns true when the cap moved and layout must be measured again.
  function fitImage(height) {
    var cap = heightCap();
    var img = root.querySelector("img.card");
    var ratio = img ? (Number(img.getAttribute("width")) / Number(img.getAttribute("height"))) || (img.naturalWidth / img.naturalHeight) || 0 : 0;
    var current = parseFloat(html.style.getPropertyValue("--img-max-w")) || 0;
    if (!cap || !ratio) {
      if (!current) return false;
      html.style.removeProperty("--img-max-w");
      return true;
    }
    var chrome = height - img.getBoundingClientRect().height;
    var availHeight = Math.max(IMG_MIN_HEIGHT, cap - chrome);
    var next = Math.floor((availHeight - 2) * ratio); // 2: the border-box's top and bottom borders
    if (Math.abs(next - current) <= 1) return false;
    html.style.setProperty("--img-max-w", next + "px");
    return true;
  }
  function measure() {
    raf = 0;
    html.style.height = "max-content";
    var height = Math.ceil(html.getBoundingClientRect().height);
    if (!height) { html.style.height = ""; return; } // hidden frame: never pin 0px
    if (fitImage(height)) height = Math.ceil(html.getBoundingClientRect().height);
    var cap = heightCap();
    if (cap && height > cap && !html.classList.contains("compact")) {
      // One-way per render (show() resets it), so it can never flap.
      html.classList.add("compact");
      height = Math.ceil(html.getBoundingClientRect().height);
    }
    html.style.height = fixedHeight() ? "100vh" : height + "px";
    var width = Math.ceil(window.innerWidth);
    if (width === last.width && height === last.height) return;
    last = { width: width, height: height };
    notify("ui/notifications/size-changed", { width: width, height: height });
  }
  function sizeChanged() {
    if (!raf) raf = requestAnimationFrame(measure);
  }
  // Right after a DOM mutation: pin synchronously so a host that reads the
  // document height itself (rather than listening for size-changed) never
  // sees the previous state's height, then settle again on the next frame.
  function measureNow() {
    measure();
    sizeChanged();
  }
  function whenDecoded(img) {
    return new Promise(function (resolve) {
      if (img.complete && img.naturalHeight) return resolve();
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
      if (typeof img.decode === "function") img.decode().then(resolve, function () {});
    });
  }
  function show(markup) {
    html.classList.remove("compact");
    root.innerHTML = markup;
    measureNow();
    var img = root.querySelector("img.card");
    if (img) whenDecoded(img).then(sizeChanged);
  }

  if (window.ResizeObserver) {
    var ro = new ResizeObserver(sizeChanged);
    ro.observe(html);
    ro.observe(document.body);
  }

  // Width/height of a PNG from the IHDR in its base64 head, so the <img> has
  // its aspect ratio (and the document its final height) before decode.
  function pngSize(b64) {
    try {
      var head = atob(b64.slice(0, 32)); // 24 bytes: signature, IHDR length+type, width, height
      if (head.charCodeAt(1) !== 0x50 || head.substr(12, 4) !== "IHDR") return null;
      var u32 = function (o) {
        return ((head.charCodeAt(o) << 24) | (head.charCodeAt(o + 1) << 16) | (head.charCodeAt(o + 2) << 8) | head.charCodeAt(o + 3)) >>> 0;
      };
      var w = u32(16), h = u32(20);
      return w && h ? { width: w, height: h } : null;
    } catch (e) { return null; }
  }

  function imageOf(result) {
    var blocks = (result && result.content) || [];
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i] && blocks[i].type === "image" && blocks[i].data) return blocks[i];
    }
    return null;
  }
  function textOf(result) {
    var blocks = (result && result.content) || [];
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i] && blocks[i].type === "text") return blocks[i].text || "";
    }
    return "";
  }

  // The drawn card: the same sections, strings and order as the PNG
  // (src/lib/tx-review/card.ts), from structuredContent.summary. Every value
  // goes through esc(); nothing here is trusted markup.
  function firstLast(value, first, last) {
    var s = String(value || "");
    return s.length <= first + last ? s : s.slice(0, first) + "..." + s.slice(-last);
  }
  function amountList(amounts, cls) {
    var out = [];
    for (var i = 0; i < (amounts || []).length; i++) {
      out.push('<div class="' + cls + '">' + esc(amounts[i].display) + "</div>");
    }
    return out.join("");
  }
  function joinDisplays(amounts) {
    var out = [];
    for (var i = 0; i < (amounts || []).length; i++) out.push(esc(amounts[i].display));
    return out.join(" + ");
  }
  function stat(label, valueMarkup) {
    return '<div class="stat"><div class="label">' + esc(label) + '</div><div class="strong">' + valueMarkup + "</div></div>";
  }
  function signerNames(list) {
    var names = [];
    for (var i = 0; i < (list || []).length; i++) names.push(list[i].label || firstLast(list[i].address, 10, 6));
    return names.join(", ");
  }
  function cardMarkup(s) {
    var wallet = s.wallet || {};
    var threshold = s.threshold || {};
    var sigs = s.signatures || { signed: [], rejected: [], remaining: 0 };
    var signed = (sigs.signed || []).length;
    var pending = s.kind === "pending";
    var h = '<div class="card">';

    h += '<div class="head"><div><div class="name">' + esc(wallet.name || "Multisig wallet") + "</div>" +
      '<div class="sub">' + esc((wallet.network === "mainnet" ? "Mainnet" : "Preprod") + " · " +
        threshold.required + " of " + threshold.total + " signatures required · " + firstLast(wallet.address, 14, 8)) + "</div></div>";
    h += pending
      ? '<span class="pill' + (signed >= threshold.required ? " done" : "") + '">' + esc("PENDING · " + signed + " OF " + threshold.required + " SIGNED") + "</span>"
      : '<span class="pill">UNSIGNED PREVIEW</span>';
    h += "</div>";

    if (s.description) h += '<div class="desc">' + esc('"' + s.description + '"') + "</div>";

    var recipients = s.recipients || [];
    if (recipients.length) {
      h += '<div class="section"><div class="label">' + (recipients.length === 1 ? "Recipient" : "Recipients") + "</div>";
      for (var i = 0; i < recipients.length; i++) {
        var r = recipients[i];
        h += '<div class="line"><div class="who">' +
          (r.label ? '<div class="strong">' + esc(r.label) + "</div>" : '<div class="strong warn">Unknown address</div>') +
          '<div class="addr">' + esc(firstLast(r.address, 22, 12)) + "</div></div>" +
          '<div class="amounts">' + ((r.amounts || []).length ? amountList(r.amounts, "strong") : '<span class="err">no amount</span>') + "</div></div>";
      }
      h += "</div>";
    }

    var actions = s.actions || [];
    if (actions.length) {
      h += '<div class="section"><div class="label">Actions</div>';
      for (var j = 0; j < actions.length; j++) {
        var a = actions[j];
        h += '<div class="line col"><div class="row"><span class="strong ' + (a.kind === "vote" ? "vote" : "cert") + '">' + esc(a.label) + "</span>" +
          (a.title ? "<span>" + esc(String(a.title).slice(0, 80)) + "</span>" : "") +
          (a.detail ? '<span class="addr">' + esc(a.detail) + "</span>" : "") + "</div>";
        var rationale = a.rationale;
        if (rationale && rationale.status === "will-publish-on-confirm") {
          h += '<div class="muted">' + esc('Rationale (published to IPFS on confirm): "' + rationale.excerpt + '"') + "</div>";
        } else if (rationale && rationale.status === "anchored") {
          h += '<div class="muted">' + esc("Rationale: " + String(rationale.url).slice(0, 90)) + "</div>";
        }
        h += "</div>";
      }
      h += "</div>";
    }

    var inputs = s.inputs || { count: 0, unresolved: 0 };
    h += '<div class="stats">' +
      stat("Fee", esc(s.fee ? s.fee.display : "—")) +
      (s.deposit ? stat("Deposit", esc(s.deposit.display)) : "") +
      stat("Change to this wallet", (s.change || []).length ? joinDisplays(s.change) : "none") +
      stat("Inputs", esc(String(inputs.count) + (inputs.unresolved > 0 ? " (" + inputs.unresolved + " unresolved)" : ""))) +
      (s.sizeBytes ? stat("Size", esc((s.sizeBytes / 1024).toFixed(1) + " KB")) : "") +
      "</div>";

    if (s.metadataMessage) h += '<div class="muted">' + esc('On-chain message: "' + s.metadataMessage + '"') + "</div>";

    if (pending) {
      h += '<div class="row"><span class="ok">' + esc("Signed: " + (signerNames(sigs.signed) || "nobody yet")) + "</span>";
      if ((sigs.rejected || []).length) h += '<span class="err">' + esc("Rejected: " + signerNames(sigs.rejected)) + "</span>";
      h += "</div>";
    }

    var warnings = s.warnings || [];
    for (var w = 0; w < warnings.length; w++) h += '<div class="warn">' + esc("Warning: " + warnings[w]) + "</div>";

    h += '<div class="hash">' + esc("Tx hash " + (s.txHash || "")) + "</div>";
    h += '<div class="banner">' + esc(pending
      ? "Awaiting " + sigs.remaining + " more signature" + (sigs.remaining === 1 ? "" : "s") + " in the Mesh Multisig app. Nothing is broadcast until the threshold is met."
      : "Nothing has been signed or broadcast. Signers approve in the Mesh Multisig app.") + "</div>";
    return h + "</div>";
  }

  function render() {
    var result = state.result;
    var sc = (result && result.structuredContent) || {};
    var image = imageOf(result);
    if (result && result.isError) {
      show('<div class="status err">' + esc(sc.error || textOf(result) || "The tool reported an error.") + "</div>");
      return;
    }
    var summary = sc.summary || {};
    state.kind = summary.kind || (sc.draftToken ? "preview" : "pending");
    state.draftToken = sc.draftToken || null;

    var markup = "";
    if (image) {
      var mime = image.mimeType || "image/png";
      var dims = mime === "image/png" ? pngSize(image.data) : null;
      markup += '<img class="card" alt="Transaction review card"' +
        (dims ? ' width="' + dims.width + '" height="' + dims.height + '"' : "") +
        ' src="data:' + esc(mime) + ";base64," + image.data + '">';
    } else if (summary.wallet) {
      markup += cardMarkup(summary);
    } else {
      markup += "<pre>" + esc(textOf(result)) + "</pre>";
    }

    if (state.kind === "preview" && state.draftToken) {
      var expires = sc.expiresAt ? new Date(sc.expiresAt) : null;
      markup += '<div class="facts">Unsigned preview. Nothing has been saved, signed or broadcast.' +
        (expires ? ' This preview can be confirmed until <b>' + esc(expires.toLocaleTimeString()) + "</b>." : "") + "</div>";
      markup += '<div class="row"><button class="primary" id="confirm">Confirm and create for signers</button>' +
        '<span class="hint">Creates the pending transaction exactly as shown. Signers still sign in the app.</span></div>';
      markup += '<div id="status"></div>';
    } else {
      var id = sc.transactionId;
      var link = sc.link;
      markup += '<div class="facts">' +
        (id ? "Pending transaction <b>" + esc(id) + "</b>. " : "") +
        (summary.signatures && summary.threshold ? "Signatures: <b>" + esc(summary.signatures.signed.length) + " of " + esc(summary.threshold.required) + "</b> collected. " : "") +
        "Nothing is broadcast until the threshold is met.</div>";
      if (link) markup += '<div class="row"><button id="open" data-url="' + esc(link) + '">Open in the app to sign</button></div>';
    }
    show(markup);

    var confirm = document.getElementById("confirm");
    if (confirm) confirm.addEventListener("click", onConfirm);
    var open = document.getElementById("open");
    if (open) open.addEventListener("click", function () {
      request("ui/open-link", { url: open.getAttribute("data-url") }).catch(function () {});
    });
  }

  function setStatus(cls, text) {
    var el = document.getElementById("status");
    if (el) { el.className = "status " + cls; el.textContent = text; measureNow(); }
  }

  function onConfirm() {
    if (state.busy || !state.draftToken) return;
    state.busy = true;
    var button = document.getElementById("confirm");
    if (button) { button.disabled = true; button.textContent = "Creating…"; }
    setStatus("", "Creating the pending transaction for the signers…");
    request("tools/call", { name: "transaction_propose", arguments: { draftToken: state.draftToken } })
      .then(function (result) {
        state.busy = false;
        var sc = (result && result.structuredContent) || {};
        if (result && result.isError) {
          if (button) { button.disabled = false; button.textContent = "Confirm and create for signers"; }
          setStatus("err", sc.error || textOf(result) || "Creating the transaction failed.");
          return;
        }
        state.result = result;
        render();
        var id = sc.transactionId ? " " + sc.transactionId : "";
        var note = "The user confirmed the review card in the inline view; pending transaction" + id +
          " was created with zero signatures" + (sc.link ? " and can be signed at " + sc.link : "") + ".";
        request("ui/update-model-context", {
          content: [{ type: "text", text: note }],
          structuredContent: { confirmed: true, transactionId: sc.transactionId || null, txHash: sc.txHash || null }
        }).catch(function () {});
        var el = document.createElement("div");
        el.className = "status ok";
        el.textContent = "Created" + id + ". The wallet's signers have been notified.";
        root.appendChild(el);
        measureNow();
      })
      .catch(function (error) {
        state.busy = false;
        if (button) { button.disabled = false; button.textContent = "Confirm and create for signers"; }
        setStatus("err", (error && error.message) || "The host refused the tool call.");
      });
  }

  // Handshake first: the host keeps the frame hidden until it completes.
  request("ui/initialize", {
    protocolVersion: PROTOCOL_VERSION,
    appInfo: { name: "mesh-multisig-review-card", version: APP_VERSION },
    appCapabilities: {}
  }).then(function (result) {
    if (result && result.hostContext) applyHostContext(result.hostContext);
    notify("ui/notifications/initialized", {});
    measureNow();
  }).catch(function (error) {
    show('<div class="status err">Could not connect to the host: ' + esc((error && error.message) || "unknown error") + "</div>");
  });
})();
</script>
</body>
</html>
`;

/** The `resources/read` payload for the review-card view. */
export function reviewCardResourceContents() {
  return {
    contents: [
      {
        uri: REVIEW_CARD_RESOURCE_URI,
        mimeType: REVIEW_CARD_MIME_TYPE,
        text: REVIEW_CARD_HTML,
        _meta: REVIEW_CARD_RESOURCE_META,
      },
    ],
  };
}
