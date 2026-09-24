import { TRPCError } from "@trpc/server";
import type { NextApiRequest, NextApiResponse } from "next";

import { addCorsCacheBustingHeaders, cors } from "@/lib/cors";
import { getClientIP } from "@/lib/security/rateLimit";
import {
  applyAddressRateLimit,
  applyBotRateLimit,
  applyRateLimit,
  enforceBodySize,
} from "@/lib/security/requestGuards";
import {
  recipientsToBaseUnits,
  type DisplayRecipient,
} from "@/lib/task-payout/recipients";
import { serializeTask, trpcErrorToHttp } from "@/lib/task-payout/serialize";
import { networkFromAddress, TxReviewError } from "@/lib/tx-review/context";
import { isBotJwt, verifyJwt } from "@/lib/verifyJwt";
import { createCaller } from "@/server/api/root";
import { db } from "@/server/db";

/**
 * POST /api/v1/taskUpsert — create a task on a wallet's board, or update
 * and/or move an existing one.
 *
 * Backs the `task_upsert` MCP tool. Body:
 *   { walletId, taskId?, title?, description?, priority?, assigneeAddress?,
 *     dueDate? (ISO | null), status?, position?, recipients? }
 * `taskId` absent = create (title required); present = update, and a
 * `status` / `position` also moves it. `recipients` are in display units
 * (`ada`, or a token with its registered decimals — the same item shape as
 * `transaction_preview`'s outputs) and are converted here, so REST and MCP
 * share one contract; the board stores base units.
 *
 * Human wallet JWTs only. There is no bot scope for the board, and the MCP
 * layer never projects a bot key onto `tasks:write`. Authorization and
 * validation are the `task` router's: this handler runs it in-process.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/taskUpsert" })) return;

  await cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!enforceBodySize(req, res, 100 * 1024)) return;

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

  if (isBotJwt(payload)) {
    if (!applyBotRateLimit(req, res, payload.botId)) return;
    return res
      .status(403)
      .json({ error: "Task board writes are not available to bot keys" });
  }
  if (!applyAddressRateLimit(req, res, payload.address)) return;

  const body = (req.body ?? {}) as TaskUpsertBody;
  if (typeof body.walletId !== "string" || !body.walletId.trim()) {
    return res.status(400).json({ error: "Missing required field walletId!" });
  }
  if (body.taskId !== undefined && typeof body.taskId !== "string") {
    return res.status(400).json({ error: "Invalid taskId: must be a string" });
  }
  if (body.recipients !== undefined && !Array.isArray(body.recipients)) {
    return res
      .status(400)
      .json({ error: "Invalid recipients: must be an array" });
  }

  try {
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

    const recipients =
      body.recipients !== undefined
        ? await recipientsToBaseUnits(
            networkFromAddress(payload.address),
            body.walletId,
            body.recipients,
          )
        : undefined;
    const scalars = {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined
        ? { description: body.description }
        : {}),
      ...(body.priority !== undefined
        ? { priority: body.priority as never }
        : {}),
      ...(body.assigneeAddress !== undefined
        ? { assigneeAddress: body.assigneeAddress }
        : {}),
      ...(body.dueDate !== undefined
        ? { dueDate: body.dueDate === null ? null : new Date(body.dueDate) }
        : {}),
    };

    let task;
    let created = false;
    if (body.taskId) {
      task = await caller.task.update({
        id: body.taskId,
        ...scalars,
        ...(recipients ? { recipients } : {}),
      });
      if (body.status !== undefined || body.position !== undefined) {
        task = await caller.task.move({
          id: task.id,
          status: (body.status ?? task.status) as never,
          position: body.position ?? task.position,
        });
      }
    } else {
      if (!body.title) {
        return res.status(400).json({
          error: "title is required to create a task",
          code: "BAD_REQUEST",
        });
      }
      task = await caller.task.create({
        walletId: body.walletId,
        title: body.title,
        ...scalars,
        ...(body.status !== undefined ? { status: body.status as never } : {}),
        recipients: recipients ?? [],
      });
      created = true;
      if (body.position !== undefined) {
        task = await caller.task.move({
          id: task.id,
          status: task.status,
          position: body.position,
        });
      }
    }

    return res
      .status(created ? 201 : 200)
      .json({ task: serializeTask(task), created });
  } catch (error) {
    if (error instanceof TxReviewError) {
      const result = error.toResult();
      return res.status(result.status).json(result.body);
    }
    if (error instanceof TRPCError) {
      const mapped = trpcErrorToHttp(error);
      return res.status(mapped.status).json(mapped.body);
    }
    console.error("Error in taskUpsert handler", {
      message: (error as Error)?.message,
      stack: (error as Error)?.stack,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

type TaskUpsertBody = {
  walletId?: unknown;
  taskId?: unknown;
  title?: string;
  description?: string | null;
  status?: string;
  priority?: string | null;
  assigneeAddress?: string | null;
  dueDate?: string | null;
  position?: number;
  recipients?: DisplayRecipient[];
};
