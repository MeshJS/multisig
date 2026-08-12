import type { NextApiRequest, NextApiResponse } from "next";

import { getWalletSessionFromReq } from "@/lib/auth/walletSession";
import { applyRateLimit } from "@/lib/security/requestGuards";

/**
 * GET /api/auth/wallet-session/status
 *
 * Whether the caller currently holds a valid wallet session, and for which
 * addresses. The session cookie is HttpOnly, so a page cannot read it directly —
 * the OAuth consent screen uses this to notice that a sign-in completed in the
 * globally-mounted wallet modal and re-render itself.
 *
 * Reports only what the caller's own cookie already proves; no identifiers are
 * accepted from the request.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  if (!applyRateLimit(req, res, { keySuffix: "auth/wallet-session-status", maxRequests: 120 })) {
    return;
  }

  const session = getWalletSessionFromReq(req);
  const wallets = session?.wallets ?? [];

  return res.status(200).json({
    authorized: wallets.length > 0,
    wallets,
    primaryWallet: session?.primaryWallet ?? null,
  });
}
