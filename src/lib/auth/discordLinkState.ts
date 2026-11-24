import jwt from "jsonwebtoken";
import { randomBytes, timingSafeEqual } from "crypto";

const { sign, verify } = jwt;

/**
 * The OAuth `state` for linking a Discord account to a wallet address.
 *
 * `/api/auth/discord/start` mints it for the caller's wallet session and the
 * browser carries it to discord.com and back to `/api/auth/discord/callback`.
 *
 * Another token family sharing `JWT_SECRET`, so it follows the same rule as
 * `mcp_at` (`src/lib/oauth/accessToken.ts`) and `mcp_draft`
 * (`src/lib/tx-review/draft-token.ts`): the address travels in `sub`, never in
 * `address`, and `typ` names the family. The state used to be
 * `{ address, nonce }`, which `verifyJwt` accepted as a v1 human bearer token —
 * a working API credential for ten minutes, placed in a URL handed to a third
 * party and in our own callback's access logs. Now `verifyJwt` rejects it (no
 * `address`) and a v1 token cannot pose as a state (wrong `typ`).
 */

export const DISCORD_LINK_STATE_TYPE = "discord_link";
export const DISCORD_LINK_STATE_TTL_SECONDS = 10 * 60;

export type DiscordLinkState = {
  /** Wallet address the Discord account will be linked to. */
  address: string;
  nonce: string;
};

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET is not defined");
  return value;
}

/**
 * Cookie carrying the state's nonce, scoped to the Discord auth routes.
 *
 * The state rides in URLs (to discord.com, back to the callback), so it can
 * leak. The nonce cookie ties it to the browser that started the flow, and the
 * callback clears it whatever the outcome, so each state finishes at most once
 * — a leaked state cannot later be paired with someone else's Discord `code`.
 */
export const DISCORD_LINK_NONCE_COOKIE = "discord_link_nonce";
const NONCE_COOKIE_PATH = "/api/auth/discord";

export function mintDiscordLinkState(address: string): {
  state: string;
  nonce: string;
} {
  const nonce = randomBytes(16).toString("hex");
  const state = sign(
    { typ: DISCORD_LINK_STATE_TYPE, sub: address, nonce },
    secret(),
    { expiresIn: DISCORD_LINK_STATE_TTL_SECONDS },
  );
  return { state, nonce };
}

function cookieAttributes(maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `Path=${NONCE_COOKIE_PATH}; HttpOnly${secure}; SameSite=Lax; Max-Age=${maxAge}`;
}

export function discordLinkNonceCookie(nonce: string): string {
  return `${DISCORD_LINK_NONCE_COOKIE}=${nonce}; ${cookieAttributes(DISCORD_LINK_STATE_TTL_SECONDS)}`;
}

export function clearDiscordLinkNonceCookie(): string {
  return `${DISCORD_LINK_NONCE_COOKIE}=; ${cookieAttributes(0)}`;
}

/** Constant-time comparison of the state's nonce with the browser's cookie. */
export function nonceMatchesCookie(
  nonce: string,
  cookie: string | undefined,
): boolean {
  if (!cookie) return false;
  const a = Buffer.from(nonce);
  const b = Buffer.from(cookie);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The state's claims, or null for anything forged, expired or of another family. */
export function verifyDiscordLinkState(raw: string): DiscordLinkState | null {
  let payload: unknown;
  try {
    // secret() inside the try: an unconfigured server rejects the state
    // rather than throwing, as the callback's previous verifier did.
    payload = verify(raw, secret());
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const claims = payload as Record<string, unknown>;
  if (
    claims.typ !== DISCORD_LINK_STATE_TYPE ||
    typeof claims.sub !== "string" ||
    claims.sub.length === 0 ||
    typeof claims.nonce !== "string"
  ) {
    return null;
  }
  return { address: claims.sub, nonce: claims.nonce };
}
