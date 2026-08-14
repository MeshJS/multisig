import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "@/env";
import { assertSafeHost } from "@/lib/security/ssrf";

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
      throw new Error("Blocked: redirect not followed");
    }
    if (!response.ok) {
      throw new Error(`Upstream ${response.status}`);
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

  try {
    const html = await fetchCapped(parsed.toString());

    const extract = (property: string, nameFallback?: string) => {
      const ogRegex = new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i");
      const ogMatch = ogRegex.exec(html);
      if (ogMatch?.[1]) return ogMatch[1];
      if (nameFallback) {
        const nameRegex = new RegExp(`<meta[^>]+name=["']${nameFallback}["'][^>]+content=["']([^"']+)["']`, "i");
        const nameMatch = nameRegex.exec(html);
        if (nameMatch?.[1]) return nameMatch[1];
      }
      return undefined;
    };

    const title = extract("og:title", "title") ?? (() => {
      const titleRegex = /<title>([^<]+)<\/title>/i;
      const titleMatch = titleRegex.exec(html);
      return titleMatch?.[1];
    })();
    const description = extract("og:description", "description");
    const image = extract("og:image");
    const siteName = extract("og:site_name");

    res.status(200).json({ title, description, image, siteName, url });
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : "Failed to fetch OG";
    res.status(500).json({ error: errorMessage });
  }
}
