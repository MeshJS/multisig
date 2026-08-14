import { checkRateLimitWithInfo, getClientIP, type RateLimitResult } from "./rateLimit";

type RateLimitOptions = {
  maxRequests?: number;
  windowMs?: number;
  keySuffix?: string;
};

/**
 * Emit standard rate-limit headers so clients can pace themselves instead of
 * flying blind: X-RateLimit-* on every guarded response, plus Retry-After
 * (seconds until the window resets) on 429s.
 */
function applyRateLimitResult(res: any, info: RateLimitResult): boolean {
  const resetSeconds = Math.max(1, Math.ceil((info.resetTime - Date.now()) / 1000));
  res.setHeader("X-RateLimit-Limit", String(info.limit));
  res.setHeader("X-RateLimit-Remaining", String(info.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(info.resetTime / 1000)));
  if (!info.allowed) {
    res.setHeader("Retry-After", String(resetSeconds));
    res.status(429).json({ error: "Too many requests", retryAfterSeconds: resetSeconds });
    return false;
  }
  return true;
}

export function applyRateLimit(req: any, res: any, options: RateLimitOptions = {}): boolean {
  const {
    maxRequests = process.env.NODE_ENV === "development" ? 120 : 60,
    windowMs = 60 * 1000,
    keySuffix = "",
  } = options;

  const ip = getClientIP(req) ?? "unknown";
  const key = keySuffix ? `${ip}:${keySuffix}` : ip;

  return applyRateLimitResult(res, checkRateLimitWithInfo(key, maxRequests, windowMs));
}

/** Stricter rate limit (e.g. for bot auth). Default 15/min per IP. */
export function applyStrictRateLimit(
  req: any,
  res: any,
  options: { keySuffix: string; maxRequests?: number; windowMs?: number } = { keySuffix: "strict" },
): boolean {
  const ip = getClientIP(req) ?? "unknown";
  const key = `${ip}:${options.keySuffix}`;
  const maxRequests = options.maxRequests ?? 15;
  const windowMs = options.windowMs ?? 60 * 1000;
  return applyRateLimitResult(res, checkRateLimitWithInfo(key, maxRequests, windowMs));
}

/** Stricter rate limit for bot-authenticated requests (by botId). Call after verifying JWT. Default 40/min per bot. */
export function applyBotRateLimit(req: any, res: any, botId: string, maxRequests: number = 40): boolean {
  return applyRateLimitResult(res, checkRateLimitWithInfo(`bot:${botId}`, maxRequests, 60 * 1000));
}

/**
 * Rate limit for human-authenticated requests, keyed on the JWT address rather
 * than the IP. The counterpart to applyBotRateLimit, for endpoints both
 * identities can call. Keyed on the principal so it survives IP rotation.
 * Call after verifying the JWT. Default 40/min per address.
 */
export function applyAddressRateLimit(req: any, res: any, address: string, maxRequests: number = 40): boolean {
  return applyRateLimitResult(res, checkRateLimitWithInfo(`addr:${address}`, maxRequests, 60 * 1000));
}

export function isBodyTooLarge(body: unknown, maxBytes: number): boolean {
  try {
    const size = Buffer.byteLength(JSON.stringify(body ?? ""), "utf8");
    return size > maxBytes;
  } catch {
    return true;
  }
}

export function enforceBodySize(req: any, res: any, maxBytes: number): boolean {
  if (isBodyTooLarge(req.body, maxBytes)) {
    res.status(413).json({ error: "Request entity too large" });
    return false;
  }
  return true;
}

