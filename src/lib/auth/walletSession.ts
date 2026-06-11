import jwt from "jsonwebtoken";

const { sign, verify } = jwt;
import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "@/env";

export const WALLET_SESSION_COOKIE = "mesh_wallet_session";

export type WalletSessionPayload = {
  wallets: string[];
  primaryWallet?: string | null;
};

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

// `next start` always runs with NODE_ENV=production, but CI serves the
// production build over plain HTTP (http://webapp:3000), where Chromium
// silently drops `Secure` cookies. WALLET_SESSION_ALLOW_INSECURE_COOKIE lets
// the Playwright/CI stack opt out of the Secure attribute; it must never be
// set in a real deployment.
function isSecureCookieEnabled(): boolean {
  if (process.env.WALLET_SESSION_ALLOW_INSECURE_COOKIE === "true") return false;
  return env.NODE_ENV === "production";
}

export function setWalletSessionCookie(res: NextApiResponse, payload: WalletSessionPayload) {
  const token = createWalletSessionToken(payload);
  const secureAttr = isSecureCookieEnabled() ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${WALLET_SESSION_COOKIE}=${token}; Path=/; HttpOnly${secureAttr}; SameSite=Lax; Max-Age=${
      7 * 24 * 60 * 60
    }`,
  );
}

export function clearWalletSessionCookie(res: NextApiResponse) {
  const secureAttr = isSecureCookieEnabled() ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${WALLET_SESSION_COOKIE}=; Path=/; HttpOnly${secureAttr}; SameSite=Lax; Max-Age=0`,
  );
}


