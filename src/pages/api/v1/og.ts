import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "@/env";
import { assertSafeHost } from "@/lib/security/ssrf";
import { applyRateLimit } from "@/lib/security/requestGuards";
import { readMetaTags, readTitle } from "@/lib/html/metaTags";

const DEFAULT_ALLOWED_HOSTS = [
  "github.com",
  "www.github.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "www.youtube.com",
  "cardano.org",
  "www.cardano.org",
  "meshjs.dev",
  "www.meshjs.dev",
];

const MAX_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 5000;

/**
 * Every request here costs an outbound fetch of up to 1 MiB, and the endpoint
 * needs no authentication, so it is the cheapest way to make this server do
 * work on someone else's behalf. Link previews are an occasional, human-paced
 * lookup; 20 a minute per IP is generous for that.
 */
const OG_RATE_LIMIT_PER_MINUTE = 20;

/** Upstream failures we report as 502, with a message safe to show callers. */
class UpstreamError extends Error {}

function loadAllowedHosts(): { hosts: Set<string>; wildcard: boolean } {
  const raw = env.OG_ALLOWED_HOSTS?.trim();
  if (!raw) {
    return { hosts: new Set(DEFAULT_ALLOWED_HOSTS), wildcard: false };
  }
  if (raw === "*") {
    return { hosts: new Set(), wildcard: true };
  }
  const list = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
  return { hosts: new Set(list), wildcard: false };
}

async function fetchCapped(target: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "MeshMultisigOGFetcher/1.0" },
    });
    if (response.status >= 300 && response.status < 400) {
      throw new UpstreamError("Upstream redirected; redirects are not followed");
    }
    if (!response.ok) {
      throw new UpstreamError(`Upstream returned ${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) {
      const text = await response.text();
      return text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text;
    }
    const decoder = new TextDecoder();
    let received = 0;
    let html = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
    return html;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (
    !applyRateLimit(req, res, {
      keySuffix: "v1/og",
      maxRequests: OG_RATE_LIMIT_PER_MINUTE,
    })
  ) {
    return;
  }

  const { url } = req.query;
  if (typeof url !== "string") {
    res.status(400).json({ error: "Missing url" });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid url" });
    return;
  }

  if (parsed.protocol !== "https:") {
    res.status(400).json({ error: "Only https URLs are allowed" });
    return;
  }

  // URL normalises ":443" away, so any explicit port is a non-default one —
  // reject it so the allowlist can't be used to probe arbitrary services.
  if (parsed.port !== "") {
    res.status(400).json({ error: "Only the default https port is allowed" });
    return;
  }

  const { hosts, wildcard } = loadAllowedHosts();
  const host = parsed.hostname.toLowerCase();
  if (!wildcard && !hosts.has(host)) {
    res.status(400).json({ error: "Host not allowed" });
    return;
  }

  try {
    await assertSafeHost(host);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Blocked";
    res.status(400).json({ error: msg });
    return;
  }

  let html: string;
  try {
    html = await fetchCapped(parsed.toString());
  } catch (e: unknown) {
    // A slow, failing or redirecting upstream is not a fault of ours: report
    // it as a gateway error, and never echo a raw internal error message.
    if (e instanceof Error && e.name === "AbortError") {
      res.status(504).json({ error: "Upstream timed out" });
      return;
    }
    if (e instanceof UpstreamError) {
      res.status(502).json({ error: e.message });
      return;
    }
    console.error("og: fetch failed:", e);
    res.status(502).json({ error: "Could not fetch the page" });
    return;
  }

  const meta = readMetaTags(html);
  const title =
    meta.get("property:og:title") ?? meta.get("name:title") ?? readTitle(html);
  const description =
    meta.get("property:og:description") ?? meta.get("name:description");
  const image = meta.get("property:og:image");
  const siteName = meta.get("property:og:site_name");

  res.status(200).json({ title, description, image, siteName, url });
}
