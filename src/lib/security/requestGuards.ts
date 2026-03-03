import { checkRateLimit, checkRateLimitByKey, getClientIP } from "./rateLimit";

type RateLimitOptions = {
  maxRequests?: number;
  windowMs?: number;
  keySuffix?: string;
};

export function applyRateLimit(req: any, res: any, options: RateLimitOptions = {}): boolean {
  const {
    maxRequests = process.env.NODE_ENV === "development" ? 120 : 60,
    windowMs = 60 * 1000,
    keySuffix = "",
  } = options;

  const ip = getClientIP(req) ?? "unknown";
  const key = keySuffix ? `${ip}:${keySuffix}` : ip;

  if (!checkRateLimit(key, maxRequests, windowMs)) {
    res.status(429).json({ error: "Too many requests" });
    return false;
  }

  return true;
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
  if (!checkRateLimit(key, maxRequests, windowMs)) {
    res.status(429).json({ error: "Too many requests" });
    return false;
  }
  return true;
}

/** Stricter rate limit for bot-authenticated requests (by botId). Call after verifying JWT. Default 40/min per bot. */
export function applyBotRateLimit(req: any, res: any, botId: string, maxRequests: number = 40): boolean {
  if (!checkRateLimitByKey(`bot:${botId}`, maxRequests, 60 * 1000)) {
    res.status(429).json({ error: "Too many requests" });
    return false;
  }
  return true;
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

