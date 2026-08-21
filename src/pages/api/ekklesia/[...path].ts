import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "@/env";

/**
 * Transparent proxy to the Ekklesia / Intersect Hydra voting API.
 *
 * Ekklesia's CORS only allows its own origin, so the browser cannot call it
 * directly. This route forwards `/api/ekklesia/<path>` → `${EKKLESIA_API_BASE}/<path>`,
 * passing the request body, the `Authorization: Bearer` header, and cookies in
 * both directions (Ekklesia issues a JWT as a cookie on `PUT /session`).
 *
 * See src/lib/ekklesia/SPEC.md for the reverse-engineered API.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const segments = req.query.path;
  const path = Array.isArray(segments) ? segments.join("/") : (segments ?? "");

  // Preserve the original query string (minus the catch-all `path` param).
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (key === "path") continue;
    if (Array.isArray(value)) value.forEach((v) => search.append(key, v));
    else if (value !== undefined) search.append(key, value);
  }
  const qs = search.toString();
  const url = `${env.EKKLESIA_API_BASE}/${path}${qs ? `?${qs}` : ""}`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (typeof req.headers.authorization === "string") {
    headers.Authorization = req.headers.authorization;
  }
  if (typeof req.headers.cookie === "string") {
    headers.Cookie = req.headers.cookie;
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
    });

    // Pass through any Set-Cookie (the session JWT) to the browser.
    const setCookie = upstream.headers.getSetCookie?.() ?? [];
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
