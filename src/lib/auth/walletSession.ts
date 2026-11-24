import jwt from "jsonwebtoken";

const { sign, verify } = jwt;
import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "@/env";

export const WALLET_SESSION_COOKIE = "mesh_wallet_session";

export type WalletSessionPayload = {
  wallets: string[];
  primaryWallet?: string | null;
};

/**
 * How many authorized addresses one session cookie may carry. The whole list
 * travels inside a signed JWT in a single cookie, and browsers silently DROP a
 * Set-Cookie whose name+value exceeds 4096 bytes — the old cookie then stays,
 * so the wallet the user just authorized is missing from the session while the
 * sign-in reported success. A 108-char testnet base address costs ~148 bytes
 * of cookie, so the limit is crossed at ~25 addresses. 20 (~3.35 KB with
 * Secure/SameSite attributes) stays ~700 bytes clear of it; only sessions of
 * 21-24 such wallets, which used to fit, now drop their oldest entry.
 */
export const MAX_SESSION_WALLETS = 20;

/**
 * The session's wallet list after `address` signs in: de-duplicated, with
 * `address` moved to the end as the most recently used, and the oldest
 * addresses evicted beyond MAX_SESSION_WALLETS. An evicted wallet simply has
 * to sign a nonce again — better than the whole cookie being rejected.
 */
export function addWalletToSession(
  existing: readonly unknown[] | null | undefined,
  address: string,
): string[] {
  const others = (Array.isArray(existing) ? existing : []).filter(
    (wallet): wallet is string => typeof wallet === "string" && wallet !== address,
  );
  return [...new Set(others), address].slice(-MAX_SESSION_WALLETS);
}

export function createWalletSessionToken(payload: WalletSessionPayload): string {
  return sign(payload, env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

export function parseWalletSessionToken(token: string): WalletSessionPayload | null {
  try {
    return verify(token, env.JWT_SECRET) as WalletSessionPayload;
  } catch {
    return null;
  }
}

export function getWalletSessionFromReq(req: NextApiRequest): WalletSessionPayload | null {
  const raw = req.cookies?.[WALLET_SESSION_COOKIE];
  if (!raw) return null;
  return parseWalletSessionToken(raw);
}

export function setWalletSessionCookie(res: NextApiResponse, payload: WalletSessionPayload) {
  const token = createWalletSessionToken(payload);
  const secure = env.NODE_ENV === "production";
  const secureAttr = secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${WALLET_SESSION_COOKIE}=${token}; Path=/; HttpOnly${secureAttr}; SameSite=Lax; Max-Age=${
      7 * 24 * 60 * 60
    }`,
  );
}

export function clearWalletSessionCookie(res: NextApiResponse) {
  const secure = env.NODE_ENV === "production";
  const secureAttr = secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${WALLET_SESSION_COOKIE}=; Path=/; HttpOnly${secureAttr}; SameSite=Lax; Max-Age=0`,
  );
}


