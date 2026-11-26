import { createHash, timingSafeEqual } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";

import { env } from "@/env";
import { applyStrictRateLimit } from "@/lib/security/requestGuards";

/**
 * Shared gate for the scheduler-only notification endpoints
 * (/api/notifications/drain and /api/notifications/ballot-deadlines), which the
 * GitHub workflows call with `Authorization: Bearer $NOTIFICATION_DRAIN_SECRET`.
 *
 * Both routes are public URLs and used to compare the bearer with `!==`, with
 * no rate limit: a plain string comparison returns as soon as a character
 * differs, which leaks how much of a guess was right.
 */

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Constant-time check of an Authorization header against the secret. Both sides
 * are hashed first so the buffers always have equal length: timingSafeEqual
 * throws on a length mismatch, and an early length check would leak the
 * secret's length.
 */
export function bearerMatchesSecret(
  authorization: string | string[] | undefined,
  secret: string,
): boolean {
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return false;
  }
  const token = authorization.slice("Bearer ".length);
  if (!token || !secret) return false;
  return timingSafeEqual(digest(token), digest(secret));
}

/**
 * Answers the request and returns false unless it is a POST carrying the drain
 * secret.
 *
 * Only failed attempts count against the limit: the real workflow must never be
 * 429'd because someone else guessed from a shared runner IP — neither workflow
 * handles 429, so the run would fail. The limit is per IP and in memory, so it
 * slows naive guessing rather than capping it; the constant-time comparison and
 * a long random secret are what actually protect the endpoints.
 */
export function authorizeSchedulerRequest(
  req: NextApiRequest,
  res: NextApiResponse,
  keySuffix: string,
): boolean {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return false;
  }

  // Before any secret check, so an unconfigured deployment still tells the
  // workflow it is unconfigured (they skip on 503).
  if (!env.NOTIFICATION_DRAIN_SECRET) {
    res.status(503).json({ error: "Notification drain is not configured" });
    return false;
  }

  if (bearerMatchesSecret(req.headers.authorization, env.NOTIFICATION_DRAIN_SECRET)) {
    return true;
  }

  // applyStrictRateLimit answers 429 itself once the IP is over the limit.
  if (applyStrictRateLimit(req, res, { keySuffix })) {
    res.status(401).json({ error: "Unauthorized" });
  }
  return false;
}
