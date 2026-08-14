// Rate limiting store (in production, use Redis or similar)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  /** Requests left in the current window (0 when rejected). */
  remaining: number;
  /** Unix ms when the current window resets. */
  resetTime: number;
};

function checkRateLimitInternal(key: string, maxRequests: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  // Bypass rate limiting in development if explicitly disabled
  if (process.env.NODE_ENV === "development" && process.env.DISABLE_RATE_LIMIT === "true") {
    return { allowed: true, limit: maxRequests, remaining: maxRequests, resetTime: now + windowMs };
  }

  const current = rateLimitStore.get(key);

  if (!current || now > current.resetTime) {
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true, limit: maxRequests, remaining: maxRequests - 1, resetTime: now + windowMs };
  }

  // Note: rejected requests do NOT increment the counter, so a client backing
  // off recovers as soon as the fixed window resets — the penalty never
  // self-extends.
  if (current.count >= maxRequests) {
    return { allowed: false, limit: maxRequests, remaining: 0, resetTime: current.resetTime };
  }

  current.count++;
  return {
    allowed: true,
    limit: maxRequests,
    remaining: Math.max(0, maxRequests - current.count),
    resetTime: current.resetTime,
  };
}

export function checkRateLimit(ip: string, maxRequests: number = 10, windowMs: number = 60 * 1000): boolean {
  return checkRateLimitInternal(ip, maxRequests, windowMs).allowed;
}

/** Stricter rate limit by arbitrary key (e.g. bot:${botId}). Use for bot-authenticated requests. */
export function checkRateLimitByKey(key: string, maxRequests: number = 40, windowMs: number = 60 * 1000): boolean {
  return checkRateLimitInternal(key, maxRequests, windowMs).allowed;
}

/** Like checkRateLimit/checkRateLimitByKey but returns the window metadata so callers can emit rate-limit headers. */
export function checkRateLimitWithInfo(key: string, maxRequests: number, windowMs: number): RateLimitResult {
  return checkRateLimitInternal(key, maxRequests, windowMs);
}

export function getClientIP(req: any): string {
  const forwarded = req.headers['x-forwarded-for'];
  const realIP = req.headers['x-real-ip'];
  
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() ?? 'unknown';
  }
  
  if (typeof realIP === 'string') {
    return realIP;
  }
  
  return req.socket?.remoteAddress ?? 'unknown';
}
