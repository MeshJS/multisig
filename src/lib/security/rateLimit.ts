// Rate limiting store (in production, use Redis or similar)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

function checkRateLimitInternal(key: string, maxRequests: number, windowMs: number): boolean {
  // Bypass rate limiting in development if explicitly disabled
  if (process.env.NODE_ENV === "development" && process.env.DISABLE_RATE_LIMIT === "true") {
    return true;
  }

  const now = Date.now();
  const current = rateLimitStore.get(key);

  if (!current || now > current.resetTime) {
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (current.count >= maxRequests) {
    return false;
  }

  current.count++;
  return true;
}

export function checkRateLimit(ip: string, maxRequests: number = 10, windowMs: number = 60 * 1000): boolean {
  return checkRateLimitInternal(ip, maxRequests, windowMs);
}

/** Stricter rate limit by arbitrary key (e.g. bot:${botId}). Use for bot-authenticated requests. */
export function checkRateLimitByKey(key: string, maxRequests: number = 40, windowMs: number = 60 * 1000): boolean {
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
  
  return req.socket.remoteAddress ?? 'unknown';
}
