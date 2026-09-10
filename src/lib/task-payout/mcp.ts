import { TRPCError } from "@trpc/server";

import type { McpToolResult, ToolContext } from "@/lib/mcp/tools";
import { networkFromAddress, TxReviewError } from "@/lib/tx-review/context";
import { resolveAssetMetadata } from "@/lib/tx-review/metadata";
import { collectSpecUnits, hasSpecErrors, normalizeTxSpec } from "@/lib/tx-review/spec";
import { getProvider } from "@/utils/get-provider";

/**
 * The task-board MCP tools' bodies. They call the `task` tRPC router
 * in-process through `createCaller` — the same way the v1 handlers do — so
 * authorization, validation and audit stay defined once, in the router.
 *
 * Loaded lazily from `src/lib/mcp/tools.ts`: the router module graph pulls
 * Mesh, which must stay off the MCP route's cold path.
 */

export type TaskListArgs = { walletId: string; status?: string };

export type TaskUpsertArgs = {
  walletId: string;
  taskId?: string;
  title?: string;
  description?: string | null;
  status?: string;
  priority?: string | null;
  assigneeAddress?: string | null;
  dueDate?: string | null;
  position?: number;
  /** Display units, the same item shape as transaction_preview's outputs. */
  recipients?: { address: string; ada?: string; assets?: { unit: string; quantity: string }[] }[];
};

type Caller = ReturnType<typeof import("@/server/api/root").createCaller>;

async function callerFor(ctx: ToolContext): Promise<Caller> {
  const [{ createCaller }, { db }] = await Promise.all([
    import("@/server/api/root"),
    import("@/server/db"),
  ]);
  const subject = ctx.caller.subject;
  return createCaller({
    db,
    session: {
      user: { id: subject },
      expires: new Date(ctx.caller.expiresAt * 1000).toISOString(),
    },
    sessionAddress: subject,
    sessionWallets: ctx.caller.addresses,
    primaryWallet: subject,
    ip: ctx.clientIp,
  });
}

/** tRPC errors → the v1-style `{status, body: {error}}` a tool result carries. */
export function trpcErrorToResult(error: unknown): McpToolResult {
  if (error instanceof TRPCError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "FORBIDDEN"
          ? 403
          : error.code === "UNAUTHORIZED"
            ? 401
            : error.code === "CONFLICT"
              ? 409
              : error.code === "PRECONDITION_FAILED"
                ? 412
                : error.code === "BAD_REQUEST"
                  ? 400
                  : 500;
    return { status, body: { error: error.message, code: error.code } };
  }
  throw error;
}

export async function runTaskList(args: TaskListArgs, ctx: ToolContext): Promise<McpToolResult> {
  try {
    const caller = await callerFor(ctx);
    const tasks = await caller.task.list({ walletId: args.walletId });
    const filtered = args.status ? tasks.filter((t) => t.status === args.status) : tasks;
    return {
      status: 200,
      body: {
        tasks: filtered.map(serializeTask),
        count: filtered.length,
      },
      audit: { walletId: args.walletId, count: filtered.length },
    };
  } catch (error) {
    return trpcErrorToResult(error);
  }
}

export async function runTaskUpsert(args: TaskUpsertArgs, ctx: ToolContext): Promise<McpToolResult> {
  try {
    const caller = await callerFor(ctx);
    const recipients =
      args.recipients !== undefined
        ? await recipientsToBaseUnits(args.walletId, args.recipients, ctx)
        : undefined;
    const scalars = {
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.description !== undefined ? { description: args.description } : {}),
      ...(args.priority !== undefined ? { priority: args.priority as never } : {}),
      ...(args.assigneeAddress !== undefined ? { assigneeAddress: args.assigneeAddress } : {}),
      ...(args.dueDate !== undefined ? { dueDate: args.dueDate === null ? null : new Date(args.dueDate) } : {}),
    };

    let task;
    let created = false;
    if (args.taskId) {
      task = await caller.task.update({ id: args.taskId, ...scalars, ...(recipients ? { recipients } : {}) });
      if (args.status !== undefined || args.position !== undefined) {
        task = await caller.task.move({
          id: task.id,
          status: (args.status ?? task.status) as never,
          position: args.position ?? task.position,
        });
      }
    } else {
      if (!args.title) {
        return { status: 400, body: { error: "title is required to create a task", code: "BAD_REQUEST" } };
      }
      task = await caller.task.create({
        walletId: args.walletId,
        title: args.title,
        ...scalars,
        ...(args.status !== undefined ? { status: args.status as never } : {}),
        recipients: recipients ?? [],
      });
      created = true;
      if (args.position !== undefined) {
        task = await caller.task.move({ id: task.id, status: task.status, position: args.position });
      }
    }
    return {
      status: created ? 201 : 200,
      body: { task: serializeTask(task), created },
      audit: { walletId: args.walletId, taskId: task.id, created },
    };
  } catch (error) {
    if (error instanceof TxReviewError) return error.toResult();
    return trpcErrorToResult(error);
  }
}

/**
 * Display-unit recipients → base-unit rows, through the same normalization
 * `transaction_preview` uses (registry decimals; a fractional amount for a
 * token without registered decimals is refused, never guessed).
 */
async function recipientsToBaseUnits(
  walletId: string,
  recipients: NonNullable<TaskUpsertArgs["recipients"]>,
  ctx: ToolContext,
): Promise<{ address: string; unit: string; quantity: string }[]> {
  if (recipients.length === 0) return [];
  const input = { walletId, outputs: recipients };
  const network = networkFromAddress(ctx.caller.subject);
  const assets = await resolveAssetMetadata(getProvider(network), collectSpecUnits(input), network);
  const { spec, issues } = normalizeTxSpec(input, { decimalsFor: assets.decimalsFor });
  if (hasSpecErrors(issues)) {
    throw new TxReviewError(
      400,
      "INVALID_SPEC",
      `The recipients could not be understood: ${issues
        .filter((i) => i.level === "error")
        .map((i) => i.message)
        .join(" ")}`,
      { issues },
    );
  }
  return spec.outputs.flatMap((output) =>
    output.assets.map((asset) => ({ address: output.address, unit: asset.unit, quantity: asset.quantity })),
  );
}

type TaskRow = Awaited<ReturnType<Caller["task"]["list"]>>[number];

function serializeTask(task: TaskRow) {
  return {
    id: task.id,
    walletId: task.walletId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assigneeAddress: task.assigneeAddress,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    position: task.position,
    createdBy: task.createdBy,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    recipients: task.recipients.map((r) => ({
      address: r.address,
      unit: r.unit,
      /** Base units: lovelace, or the token's raw quantity. */
      quantity: r.quantity,
      label: r.label,
    })),
    payout: task.payout,
  };
}
