import { sign, verify } from "jsonwebtoken";
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

export function setWalletSessionCookie(res: NextApiResponse, payload: WalletSessionPayload) {
  const token = createWalletSessionToken(payload);
  res.setHeader(
    "Set-Cookie",
    `${WALLET_SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${
      7 * 24 * 60 * 60
    }`,
  );
}

export function clearWalletSessionCookie(res: NextApiResponse) {
  res.setHeader(
    "Set-Cookie",
    `${WALLET_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
}


