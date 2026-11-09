import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "@/env";
import {
  MAX_EKKLESIA_SET_COOKIES,
  buildUpstreamUrl,
  rewriteSetCookie,
  upstreamCookieHeader,
} from "@/lib/ekklesia/proxy";

/**
 * Transparent proxy to the Ekklesia / Intersect Hydra voting API.
 *
 * Ekklesia's CORS only allows its own origin, so the browser cannot call it
 * directly. This route forwards `/api/ekklesia/<path>` → `${EKKLESIA_API_BASE}/<path>`,
 * passing the request body, the `Authorization: Bearer` header, and Ekklesia's
 * own cookies in both directions (Ekklesia issues a JWT as a cookie on
 * `PUT /session`). Those cookies are namespaced on our origin so the app's own
 * session cookies are never forwarded — see src/lib/ekklesia/proxy.ts.
 *
 * See src/lib/ekklesia/SPEC.md for the reverse-engineered API.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const raw = req.query.path;
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];

  // Preserve the original query string (minus the catch-all `path` param).
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (key === "path") continue;
    if (Array.isArray(value)) value.forEach((v) => search.append(key, v));
    else if (value !== undefined) search.append(key, value);
  }
  const url = buildUpstreamUrl(env.EKKLESIA_API_BASE, segments, search);
  if (!url) {
    return res.status(400).json({ error: "Invalid Ekklesia path" });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (typeof req.headers.authorization === "string") {
    headers.Authorization = req.headers.authorization;
  }
  const cookie = upstreamCookieHeader(req.headers.cookie);
  if (cookie) headers.Cookie = cookie;

  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  try {
    const upstream = await fetch(url.toString(), {
      method: req.method,
      headers,
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
    });

    // Pass Ekklesia's Set-Cookie (the session JWT) to the browser, namespaced
    // and scoped to this proxy so it can neither shadow nor read our cookies.
    const setCookie = (upstream.headers.getSetCookie?.() ?? [])
      .slice(0, MAX_EKKLESIA_SET_COOKIES)
      .map(rewriteSetCookie)
      .filter((c): c is string => c !== null);
    if (setCookie.length > 0) res.setHeader("Set-Cookie", setCookie);

    const text = await upstream.text();
    res.status(upstream.status);
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);
    res.send(text);
  } catch (error) {
    console.error("Ekklesia proxy error:", error);
    res.status(502).json({
      error: "Ekklesia proxy failed",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
