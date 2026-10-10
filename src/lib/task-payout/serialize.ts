import { TRPCError } from "@trpc/server";

import type { AnnotatedTask } from "@/server/api/routers/tasks";

/**
 * The task shape the v1 `tasks` / `taskUpsert` handlers return (and so the
 * `task_list` / `task_upsert` MCP tools, which wrap them). Dates as ISO
 * strings, recipients in base units, and the derived payout state.
 */
export function serializeTask(task: AnnotatedTask) {
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

export type SerializedTask = ReturnType<typeof serializeTask>;

/**
 * A tRPC error from the in-process `task` router → the `{status, body}` a
 * v1 handler answers with. The router owns authorization and validation, so
 * its codes are the contract; this only maps them onto HTTP.
 */
export function trpcErrorToHttp(error: TRPCError): {
  status: number;
  body: { error: string; code: string };
} {
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
  return { status, body: { error: readableMessage(error), code: error.code } };
}

/**
 * A zod input failure reaches the caller as the ZodError message, which is
 * the JSON-serialized issue list. Surface the first issue as a sentence a
 * caller (or a model) can act on instead.
 */
function readableMessage(error: TRPCError): string {
  if (error.code !== "BAD_REQUEST") return error.message;
  try {
    const issues = JSON.parse(error.message) as unknown;
    const first = Array.isArray(issues) ? (issues[0] as { path?: unknown; message?: unknown }) : null;
    if (first && typeof first.message === "string") {
      const path = Array.isArray(first.path) && first.path.length > 0 ? `${first.path.join(".")}: ` : "";
      return `${path}${first.message}`;
    }
  } catch {
    /* not a zod message */
  }
  return error.message;
}
