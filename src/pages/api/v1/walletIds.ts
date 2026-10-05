import { NextApiRequest, NextApiResponse } from "next";
import { createCaller } from "@/server/api/root";
import { db } from "@/server/db";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import {
  applyRateLimit,
  applyBotRateLimit,
} from "@/lib/security/requestGuards";
import { getClientIP } from "@/lib/security/rateLimit";
import { getWalletIdsForBot } from "@/lib/auth/botAccess";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Add cache-busting headers for CORS
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/walletIds" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res
      .status(401)
      .json({
        error:
          "Unauthorized - Missing or malformed Authorization header (expected: Bearer <token>)",
      });
  }

  const payload = verifyJwt(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  if (isBotJwt(payload) && !applyBotRateLimit(req, res, payload.botId)) {
    return;
  }

  const session = {
    user: { id: payload.address },
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
  const caller = createCaller({
    db,
    session,
    sessionAddress: payload.address,
    sessionWallets: [payload.address],
    primaryWallet: payload.address,
    ip: getClientIP(req),
  });

  const { address } = req.query;

  if (typeof address !== "string") {
    return res.status(400).json({ error: "Invalid address parameter" });
  }
  if (payload.address !== address) {
    return res.status(403).json({ error: "Address mismatch" });
  }

  try {
    let walletIds: { walletId: string; walletName: string }[];
    // Unaccepted invitations, surfaced as a number rather than by name.
    let pendingInvitations = 0;
    if (isBotJwt(payload)) {
      walletIds = await getWalletIdsForBot(db, payload.botId);
    } else {
      const caller = createCaller({
        db,
        session,
        sessionAddress: payload.address,
        sessionWallets: [payload.address],
        primaryWallet: payload.address,
        ip: getClientIP(req),
      });
      const wallets = await caller.wallet.getUserWallets({ address });
      // Only wallets this address has actually ACCEPTED are named.
      //
      // `createWallet` takes an arbitrary 256-character name and an arbitrary
      // list of signer addresses, with no consent from the addresses it names,
      // and `getUserWallets` returns every wallet that merely lists you. So any
      // authenticated stranger can put text of their choosing in front of you
      // by naming you as a signer — and this endpoint feeds an MCP tool, whose
      // results are JSON.stringify'd straight into a model's context. That is a
      // prompt-injection channel from an unrelated attacker.
      //
      // Acceptance is ownership, or having proved control of the address by
      // signing the verification nonce. Everything else is an unaccepted
      // invitation and is reported as a COUNT only: a number carries no
      // attacker-chosen text.
      const accepted = (wallets ?? []).filter(
        (w) => w.ownerAddress === address || w.verified.includes(address),
      );
      pendingInvitations = (wallets?.length ?? 0) - accepted.length;
      walletIds = accepted.map((w) => ({ walletId: w.id, walletName: w.name }));
    }

    // No memberships is a valid answer, not an error — return an empty list
    // so clients can tell "not in any wallets yet" from a bad request.
    res.setHeader(
      "Cache-Control",
      "private, max-age=120, stale-while-revalidate=300",
    );

    // The documented contract (see src/utils/swagger.ts and the dApps example)
    // is a bare array, and bots depend on it. `includePending=true` opts into
    // the richer object instead of breaking every existing caller.
    if (req.query.includePending === "true") {
      return res.status(200).json({ wallets: walletIds, pendingInvitations });
    }
    res.status(200).json(walletIds);
  } catch (error) {
    console.error("Error fetching wallet IDs:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
