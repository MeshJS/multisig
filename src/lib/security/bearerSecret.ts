import { createHash, timingSafeEqual } from "crypto";

/**
 * Shared-secret bearer check for the machine-only endpoints that GitHub
 * workflows call with `Authorization: Bearer <secret>` (notification drain,
 * ballot deadlines, balance snapshots).
 *
 * A plain `!==` returns as soon as a character differs, which leaks how much of
 * a guess was right. Both sides are hashed first so the buffers always have
 * equal length: timingSafeEqual throws on a length mismatch, and an early length
 * check would leak the secret's length.
 */

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

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
