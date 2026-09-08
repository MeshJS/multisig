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
 * the PNG arrives as a data: URL inside the tool result — so it runs under
 * the extension's default CSP (`script-src 'self' 'unsafe-inline'`,
 * `img-src 'self' data:`, `connect-src 'none'`). It talks to the host over
 * JSON-RPC 2.0 postMessage exactly as the spec describes, hand-rolled rather
 * than via `@modelcontextprotocol/ext-apps` (which peers on SDK v1 and would
 * have to be bundled into the page).
 *
 * What the view does:
 *  - handshake: `ui/initialize` → `ui/notifications/initialized`
 *  - on `ui/notifications/tool-result`: show the card image and the summary
 *    facts; for a preview, offer a **Confirm** button
 *  - Confirm → `tools/call transaction_propose { draftToken }` through the
 *    host; the human's click is the confirmation the design requires
 *  - after a successful propose: show the final card, an "Open in app" link
 *    (`ui/open-link`), and tell the model via `ui/update-model-context`
 *  - `ui/notifications/size-changed` after every render so the iframe fits
 *
 * Text-only clients are unaffected: the tool result still carries the text
 * block and the image block, and the resource is simply never read.
 */

export const REVIEW_CARD_RESOURCE_URI = "ui://mesh-multisig/review-card";
export const REVIEW_CARD_MIME_TYPE = "text/html;profile=mcp-app";
export const MCP_APPS_PROTOCOL_VERSION = "2026-01-26";

/** Resource-level UI metadata: no network, no external assets, a framed card. */
export const REVIEW_CARD_RESOURCE_META = {
  ui: {
    prefersBorder: true,
    csp: { connectDomains: [], resourceDomains: [], frameDomains: [] },
  },
} as const;

export const REVIEW_CARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Transaction review card</title>
<style>
  :root { color-scheme: light dark; --fg: #0f172a; --muted: #64748b; --bg: #ffffff; --panel: #f1f5f9; --border: #e2e8f0; --accent: #f59e0b; --accent-ink: #1f1300; --ok: #16a34a; --err: #dc2626; }
  html[data-theme="dark"] { --fg: #f1f5f9; --muted: #94a3b8; --bg: #0b1220; --panel: #111a2e; --border: #1f2a44; }
  html, body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  #root { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
  img.card { width: 100%; height: auto; display: block; border-radius: 10px; border: 1px solid var(--border); }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .facts { color: var(--muted); font-size: 13px; }
  .facts b { color: var(--fg); font-weight: 600; }
  button { font: inherit; font-weight: 600; padding: 10px 16px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel); color: var(--fg); cursor: pointer; }
  button.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; }
  button:disabled { opacity: .6; cursor: default; }
  .status { padding: 10px 12px; border-radius: 8px; background: var(--panel); border: 1px solid var(--border); }
  .status.ok { border-color: var(--ok); }
  .status.err { border-color: var(--err); color: var(--err); }
  .hint { color: var(--muted); font-size: 12px; }
  pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
<div id="root"><div class="hint">Waiting for the transaction…</div></div>
<script>
(function () {
  "use strict";
  var PROTOCOL_VERSION = "${MCP_APPS_PROTOCOL_VERSION}";
  var root = document.getElementById("root");
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

  function applyHostContext(ctx) {
    state.hostContext = Object.assign({}, state.hostContext || {}, ctx);
    if (ctx.theme) document.documentElement.setAttribute("data-theme", ctx.theme);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function show(html) {
    root.innerHTML = html;
    sizeChanged();
  }
  function sizeChanged() {
    var h = document.documentElement.scrollHeight;
    notify("ui/notifications/size-changed", { width: document.documentElement.scrollWidth, height: h });
  }
  if (window.ResizeObserver) {
    new ResizeObserver(function () { sizeChanged(); }).observe(document.body);
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

    var html = "";
    if (image) {
      html += '<img class="card" alt="Transaction review card" src="data:' + esc(image.mimeType || "image/png") + ";base64," + image.data + '">';
    } else {
      html += "<pre>" + esc(textOf(result)) + "</pre>";
    }

    if (state.kind === "preview" && state.draftToken) {
      var expires = sc.expiresAt ? new Date(sc.expiresAt) : null;
      html += '<div class="facts">Unsigned preview. Nothing has been saved, signed or broadcast.' +
        (expires ? ' This preview can be confirmed until <b>' + esc(expires.toLocaleTimeString()) + "</b>." : "") + "</div>";
      html += '<div class="row"><button class="primary" id="confirm">Confirm and create for signers</button>' +
        '<span class="hint">Creates the pending transaction exactly as shown. Signers still sign in the app.</span></div>';
      html += '<div id="status"></div>';
    } else {
      var id = sc.transactionId;
      var link = sc.link;
      html += '<div class="facts">' +
        (id ? "Pending transaction <b>" + esc(id) + "</b>. " : "") +
        (summary.signatures ? "Signatures: <b>" + esc(summary.signatures.signed.length) + " of " + esc(summary.threshold.required) + "</b> collected. " : "") +
        "Nothing is broadcast until the threshold is met.</div>";
      if (link) html += '<div class="row"><button id="open" data-url="' + esc(link) + '">Open in the app to sign</button></div>';
    }
    show(html);

    var confirm = document.getElementById("confirm");
    if (confirm) confirm.addEventListener("click", onConfirm);
    var open = document.getElementById("open");
    if (open) open.addEventListener("click", function () {
      request("ui/open-link", { url: open.getAttribute("data-url") }).catch(function () {});
    });
  }

  function setStatus(cls, text) {
    var el = document.getElementById("status");
    if (el) { el.className = "status " + cls; el.textContent = text; sizeChanged(); }
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
        sizeChanged();
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
    appInfo: { name: "mesh-multisig-review-card", version: "1.0.0" },
    appCapabilities: {}
  }).then(function (result) {
    if (result && result.hostContext) applyHostContext(result.hostContext);
    notify("ui/notifications/initialized", {});
    sizeChanged();
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
