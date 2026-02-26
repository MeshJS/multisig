import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const BOT_KEY_BYTES = 32;
const HASH_ENCODING = "hex";

/**
 * Hash a bot key secret for storage. Uses HMAC-SHA256 with JWT_SECRET as key so the DB alone is not enough to verify.
 */
export function hashBotKeySecret(secret: string): string {
  const pepper = process.env.JWT_SECRET;
  if (!pepper) throw new Error("JWT_SECRET not set");
  return createHmac("sha256", pepper).update(secret, "utf8").digest(HASH_ENCODING);
}

/**
 * Generate a new bot key secret (show once to the user).
 */
export function generateBotKeySecret(): string {
  return randomBytes(BOT_KEY_BYTES).toString(HASH_ENCODING);
}

/**
 * Verify a plaintext secret against a stored keyHash. Constant-time comparison.
 */
export function verifyBotKeySecret(secret: string, keyHash: string): boolean {
  const computed = hashBotKeySecret(secret);
  if (computed.length !== keyHash.length) return false;
  try {
    return timingSafeEqual(Buffer.from(computed, HASH_ENCODING), Buffer.from(keyHash, HASH_ENCODING));
  } catch {
    return false;
  }
}

export const BOT_SCOPES = [
  "multisig:create",
  "multisig:read",
  "multisig:sign",
  "governance:read",
  "ballot:write",
] as const;
export type BotScope = (typeof BOT_SCOPES)[number];

export function parseScope(scope: string): BotScope[] {
  try {
    const arr = JSON.parse(scope) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((s): s is BotScope => typeof s === "string" && BOT_SCOPES.includes(s as BotScope));
  } catch {
    return [];
  }
}

export function scopeIncludes(parsed: BotScope[], required: BotScope): boolean {
  return parsed.includes(required);
}
