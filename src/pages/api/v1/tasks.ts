import { TRPCError } from "@trpc/server";
import type { NextApiRequest, NextApiResponse } from "next";

import { getBotWalletAccess } from "@/lib/auth/botAccess";
import { addCorsCacheBustingHeaders, cors } from "@/lib/cors";
import { getClientIP } from "@/lib/security/rateLimit";
import { applyBotRateLimit, applyRateLimit } from "@/lib/security/requestGuards";
import { serializeTask, trpcErrorToHttp } from "@/lib/task-payout/serialize";
import { isBotJwt, verifyJwt } from "@/lib/verifyJwt";
import { createCaller } from "@/server/api/root";
import { listWalletTasks, TASK_STATUSES, type AnnotatedTask } from "@/server/api/routers/tasks";
import { db } from "@/server/db";

/**
 * GET /api/v1/tasks?walletId=&address=[&status=][&payable=true] — a wallet's
 * project task board, with each task's payout state.
 *
 * Backs the `task_list` MCP tool. Two identities, resolved the way every
 * wallet read here is:
 *  - a human wallet JWT goes through `caller.task.list`, so the router's
 *    signer-or-owner rule applies and there is one place to change it;
 *  - a bot JWT is authorized by its WalletBotAccess grant (observer is
 *    enough — the board is a read), then reads the same query the router
 *    uses. A bot's payment address is not a signer, so the router's session
 *    check cannot be what admits it.
 *
 * `payableCount` is the wallet-wide total before any filter: what
 * `task_prepare_payout` would pay when called without task ids.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/tasks" })) return;

  await cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({
      error:
        "Unauthorized - Missing or malformed Authorization header (expected: Bearer <token>)",
    });
  }

  const payload = verifyJwt(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  if (isBotJwt(payload) && !applyBotRateLimit(req, res, payload.botId)) return;

  const { walletId, address, status, payable } = req.query;
  if (typeof address !== "string") {
    return res.status(400).json({ error: "Invalid address parameter" });
  }
  if (payload.address !== address) {
    return res.status(403).json({ error: "Address mismatch" });
  }
  if (typeof walletId !== "string" || !walletId.trim()) {
    return res.status(400).json({ error: "Invalid walletId parameter" });
  }
  if (
    status !== undefined &&
    !(TASK_STATUSES as readonly string[]).includes(String(status))
  ) {
    return res.status(400).json({
      error: `Invalid status parameter (expected one of ${TASK_STATUSES.join(", ")})`,
    });
  }
  const onlyPayable = payable === "true";

  try {
    let tasks: AnnotatedTask[];
    if (isBotJwt(payload)) {
      const access = await getBotWalletAccess(db, walletId, payload.botId);
      if (!access.allowed) {
        // Convention: 404 = unknown wallet, 403 = known but not permitted.
        return access.reason === "wallet_not_found"
          ? res.status(404).json({ error: "Wallet not found" })
          : res.status(403).json({ error: "Not authorized for this wallet" });
      }
      tasks = await listWalletTasks(db, walletId);
    } else {
      const caller = createCaller({
        db,
        session: {
          user: { id: payload.address },
          expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
        sessionAddress: payload.address,
        sessionWallets: [payload.address],
        primaryWallet: payload.address,
        ip: getClientIP(req),
      });
      tasks = await caller.task.list({ walletId });
    }

    const payableCount = tasks.filter((t) => t.payout.payable).length;
    const filtered = tasks
      .filter((t) => status === undefined || t.status === status)
      .filter((t) => !onlyPayable || t.payout.payable);

    return res.status(200).json({
      tasks: filtered.map(serializeTask),
      count: filtered.length,
      payableCount,
    });
  } catch (error) {
    if (error instanceof TRPCError) {
      const mapped = trpcErrorToHttp(error);
      return res.status(mapped.status).json(mapped.body);
    }
    console.error("Error in tasks handler", {
      message: (error as Error)?.message,
      stack: (error as Error)?.stack,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
