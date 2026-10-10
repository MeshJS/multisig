import { timingSafeEqual } from "crypto";
import * as dns from "node:dns/promises";
import { Agent, buildConnector, request } from "undici";
import { hashDrepAnchor } from "@meshsdk/core";

function isPrivateOrLoopbackAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true;
    if (lower.startsWith("fe80:")) return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    return false;
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === undefined || b === undefined) return false;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 12_000;

function normalizeHexForCompare(h: string): Buffer {
  const s = h.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]+$/.test(s) || s.length % 2 !== 0) {
    throw new Error("anchorDataHash must be hex");
  }
  return Buffer.from(s, "hex");
}

type SafeTarget = { url: URL; ip: string; family: 4 | 6 };

async function assertUrlSafeForFetch(urlStr: string): Promise<SafeTarget> {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error("Invalid anchor URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("Anchor URL must use http or https");
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan")
  ) {
    throw new Error("Anchor URL hostname not allowed");
  }

  let records: { address: string; family: number }[];
  try {
    const lookedUp = await dns.lookup(host, { all: true });
    records = Array.isArray(lookedUp) ? lookedUp : [lookedUp];
  } catch {
    throw new Error("Could not resolve anchor URL host");
  }
  if (records.length === 0) {
    throw new Error("Could not resolve anchor URL host");
  }
  for (const { address } of records) {
    if (isPrivateOrLoopbackAddress(address)) {
      throw new Error("Anchor URL resolves to a private or loopback address");
    }
  }
  // Pin the first validated record so the actual fetch can't be DNS-rebound
  // to a private/loopback IP between validation and connection.
  const first = records[0]!;
  const family: 4 | 6 = first.family === 6 ? 6 : 4;
  return { url: u, ip: first.address, family };
}

async function readUndiciBodyWithLimit(
  body: import("undici").Dispatcher.ResponseData["body"],
  maxBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as Buffer);
    total += view.length;
    if (total > maxBytes) {
      throw new Error(`Anchor response exceeds ${maxBytes} bytes`);
    }
    chunks.push(view);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Fetches JSON from anchorUrl, parses JSON, computes hashDrepAnchor (same as registerDrep after upload).
 * Optional expectedAnchorDataHash (hex): rejects on mismatch.
 *
 * SSRF defense: assertUrlSafeForFetch validates the URL (protocol, hostname
 * blocklist, DNS lookup, private/loopback IP rejection) and returns the
 * resolved IP. The fetch then uses a pinned-IP undici Agent so the
 * actual TCP connection targets that exact IP — eliminating the TOCTOU
 * window where DNS could be rebound between validation and connect.
 */
export async function resolveDRepAnchorFromUrl(
  anchorUrl: string,
  expectedAnchorDataHash?: string,
): Promise<{ anchorUrl: string; anchorDataHash: string }> {
  const trimmed = anchorUrl.trim();
  if (!trimmed) {
    throw new Error("anchorUrl is required");
  }
  const target = await assertUrlSafeForFetch(trimmed);

  // Pin the resolved IP so the TCP connection can't be DNS-rebound between
  // the safety check above and the actual connect. buildConnector wires
  // its `lookup` into both net.createConnection (HTTP) and tls.connect
  // (HTTPS); the SNI/Host header still comes from the original hostname.
  const connector = buildConnector({
    lookup: (_hostname, _options, cb) => cb(null, target.ip, target.family),
  });
  const agent = new Agent({
    connect: connector,
    headersTimeout: TIMEOUT_MS,
    bodyTimeout: TIMEOUT_MS,
  });

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let res: import("undici").Dispatcher.ResponseData;
  try {
    res = await request(target.url, {
      dispatcher: agent,
      method: "GET",
      maxRedirections: 0,
      signal: ac.signal,
      headers: { accept: "application/json, */*" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Anchor fetch failed: ${msg}`);
  } finally {
    clearTimeout(t);
  }

  if (res.statusCode < 200 || res.statusCode >= 300) {
    // Drain body to free the socket before throwing.
    try { for await (const _ of res.body) { /* discard */ } } catch { /* ignore */ }
    throw new Error(`Anchor fetch failed: HTTP ${res.statusCode}`);
  }

  const buf = await readUndiciBodyWithLimit(res.body, MAX_BYTES);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new Error("Anchor URL did not return valid JSON");
  }

  const anchorDataHash = hashDrepAnchor(json as object);

  if (expectedAnchorDataHash !== undefined && expectedAnchorDataHash !== "") {
    const a = normalizeHexForCompare(anchorDataHash);
    const b = normalizeHexForCompare(expectedAnchorDataHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error("anchorDataHash does not match content at anchorUrl");
    }
  }

  return { anchorUrl: trimmed, anchorDataHash };
}

/** Hex compare for tests / external verification */
export function hexEqualConstantTime(a: string, b: string): boolean {
  try {
    const ba = normalizeHexForCompare(a);
    const bb = normalizeHexForCompare(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}
