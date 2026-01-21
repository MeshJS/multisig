import { checkRateLimit, getClientIP } from "./rateLimit";

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

