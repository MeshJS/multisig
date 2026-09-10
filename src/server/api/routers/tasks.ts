import { TRPCError } from "@trpc/server";
import type { Prisma, TaskStatus } from "@prisma/client";
import { z } from "zod";

import { audit } from "@/lib/observability/audit";
import { derivePayoutState } from "@/lib/task-payout/state";
import { assertWalletAccess, requireSessionAddress } from "@/server/api/auth";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import type { AuthCtx } from "@/server/api/trpc";

/**
 * Project task board: tasks per wallet in four fixed columns, optional
 * payment recipients per task (base units), and payouts prepared through
 * the same server-side pipeline the MCP tools use — preview, then confirm
 * with the draft token; the pending transaction starts with zero signatures
 * and the tasks are linked in the same database transaction.
 *
 * Authorization is signer-or-owner via `assertWalletAccess` for every
 * procedure; child rows are reached through their task's walletId.
 */

export const TASK_STATUSES = ["Backlog", "InProgress", "InReview", "Done"] as const;
export const TASK_PRIORITIES = ["Low", "Medium", "High"] as const;
export const MAX_TASK_RECIPIENTS = 20;
export const MAX_PAYOUT_TASKS = 20;

const statusEnum = z.enum(TASK_STATUSES);
const priorityEnum = z.enum(TASK_PRIORITIES);

const ADDRESS_PATTERN = /^addr(_test)?1[0-9a-z]+$/;
const UNIT_PATTERN = /^[0-9a-f]{56,120}$/;

const recipientInput = z.object({
  address: z.string().regex(ADDRESS_PATTERN, "Recipient must be a bech32 payment address"),
  unit: z
    .string()
    .transform((u) => (u === "lovelace" ? u : u.toLowerCase()))
    .refine((u) => u === "lovelace" || UNIT_PATTERN.test(u), "Unit must be lovelace or policyId+assetName hex"),
  /** Base units (lovelace / raw token quantity), integer string. */
  quantity: z
    .string()
    .regex(/^\d+$/, "Amount must be an integer in base units")
    .refine((q) => BigInt(q) > 0n, "Amount must be greater than zero"),
  label: z.string().trim().max(64).optional(),
});

const taskScalars = {
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  priority: priorityEnum.nullable().optional(),
  assigneeAddress: z.string().trim().max(120).nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
};

const taskInclude = {
  recipients: { orderBy: { position: "asc" as const } },
  payouts: { where: { status: { in: ["Pending", "Paid"] as const } } },
} satisfies Prisma.TaskInclude;

type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

function annotate(task: TaskWithRelations) {
  return { ...task, payout: derivePayoutState(task) };
}

async function loadTaskForWrite(ctx: AuthCtx, id: string) {
  const task = await ctx.db.task.findUnique({ where: { id }, include: taskInclude });
  if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  await assertWalletAccess(ctx, task.walletId);
  return task;
}

function hasPendingPayout(task: { payouts: { status: string }[] }) {
  return task.payouts.some((p) => p.status === "Pending");
}

/**
 * Writes dense 0..n positions for one column. Columns are small (a board,
 * not a backlog database), so sequential updates are fine and keep the SQL
 * portable.
 */
async function renumberColumn(
  db: Prisma.TransactionClient,
  walletId: string,
  status: TaskStatus,
  orderedIds: string[],
) {
  for (let position = 0; position < orderedIds.length; position++) {
    await db.task.update({ where: { id: orderedIds[position]! }, data: { status, position } });
  }
}

async function nextPosition(db: Prisma.TransactionClient | AuthCtx["db"], walletId: string, status: TaskStatus) {
  const max = await db.task.aggregate({ where: { walletId, status }, _max: { position: true } });
  return (max._max.position ?? -1) + 1;
}

function mapReviewError(result: { status: number; body: unknown }): TRPCError {
  const body = (result.body ?? {}) as { error?: string; code?: string };
  const code =
    result.status === 404
      ? "NOT_FOUND"
      : result.status === 403
        ? "FORBIDDEN"
        : result.status === 401
          ? "UNAUTHORIZED"
          : result.status === 409
            ? "CONFLICT"
            : result.status >= 500
              ? "INTERNAL_SERVER_ERROR"
              : "BAD_REQUEST";
  return new TRPCError({
    code,
    message: body.error ?? "The payout could not be prepared",
    cause: result.body,
  });
}

export const taskRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertWalletAccess(ctx, input.walletId);
      const tasks = await ctx.db.task.findMany({
        where: { walletId: input.walletId },
        include: taskInclude,
        orderBy: [{ status: "asc" }, { position: "asc" }, { createdAt: "asc" }],
      });
      return tasks.map(annotate);
    }),

  create: protectedProcedure
    .input(
      z.object({
        walletId: z.string(),
        status: statusEnum.optional(),
        recipients: z.array(recipientInput).max(MAX_TASK_RECIPIENTS).default([]),
        ...taskScalars,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWalletAccess(ctx, input.walletId);
      const createdBy = requireSessionAddress(ctx);
      const status = input.status ?? "Backlog";
      const position = await nextPosition(ctx.db, input.walletId, status);
      const task = await ctx.db.task.create({
        data: {
          walletId: input.walletId,
          title: input.title,
          description: input.description ?? null,
          status,
          priority: input.priority ?? null,
          assigneeAddress: input.assigneeAddress || null,
          dueDate: input.dueDate ?? null,
          position,
          createdBy,
          recipients: {
            create: input.recipients.map((r, index) => ({ ...r, label: r.label || null, position: index })),
          },
        },
        include: taskInclude,
      });
      void audit(ctx.db, {
        actorAddress: createdBy,
        actorType: "user",
        action: "task.create",
        resourceType: "task",
        resourceId: task.id,
        ip: ctx.ip ?? null,
        outcome: "success",
        metadata: { walletId: input.walletId, status, recipients: input.recipients.length },
      });
      return annotate(task);
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        recipients: z.array(recipientInput).max(MAX_TASK_RECIPIENTS).optional(),
        ...taskScalars,
        title: taskScalars.title.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await loadTaskForWrite(ctx, input.id);
      const actor = requireSessionAddress(ctx);
      if (input.recipients !== undefined && hasPendingPayout(existing)) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Recipients are locked while a payout is awaiting signatures. Delete the pending transaction first.",
        });
      }
      const data: Prisma.TaskUpdateInput = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.description !== undefined) data.description = input.description;
      if (input.priority !== undefined) data.priority = input.priority;
      if (input.assigneeAddress !== undefined) data.assigneeAddress = input.assigneeAddress || null;
      if (input.dueDate !== undefined) data.dueDate = input.dueDate;

      const task = await ctx.db.$transaction(async (db) => {
        if (input.recipients !== undefined) {
          await db.taskRecipient.deleteMany({ where: { taskId: input.id } });
          if (input.recipients.length > 0) {
            await db.taskRecipient.createMany({
              data: input.recipients.map((r, index) => ({
                taskId: input.id,
                ...r,
                label: r.label || null,
                position: index,
              })),
            });
          }
        }
        return db.task.update({ where: { id: input.id }, data, include: taskInclude });
      });
      void audit(ctx.db, {
        actorAddress: actor,
        actorType: "user",
        action: "task.update",
        resourceType: "task",
        resourceId: task.id,
        ip: ctx.ip ?? null,
        outcome: "success",
        metadata: {
          walletId: task.walletId,
          fields: Object.keys(data),
          recipients: input.recipients?.length ?? null,
        },
      });
      return annotate(task);
    }),

  /**
   * Drag-and-drop target: place the task at `position` within `status`,
   * then renumber the destination column (and the source, if it changed) so
   * positions stay dense. A same-column drop to the same index is a no-op.
   */
  move: protectedProcedure
    .input(z.object({ id: z.string(), status: statusEnum, position: z.number().int().nonnegative() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadTaskForWrite(ctx, input.id);
      const actor = requireSessionAddress(ctx);
      const task = await ctx.db.$transaction(async (db) => {
        const destination = await db.task.findMany({
          where: { walletId: existing.walletId, status: input.status, id: { not: input.id } },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          select: { id: true },
        });
        const ids = destination.map((t) => t.id);
        ids.splice(Math.min(input.position, ids.length), 0, input.id);
        await renumberColumn(db, existing.walletId, input.status, ids);
        if (existing.status !== input.status) {
          const source = await db.task.findMany({
            where: { walletId: existing.walletId, status: existing.status },
            orderBy: [{ position: "asc" }, { createdAt: "asc" }],
            select: { id: true },
          });
          await renumberColumn(db, existing.walletId, existing.status, source.map((t) => t.id));
        }
        return db.task.findUniqueOrThrow({ where: { id: input.id }, include: taskInclude });
      });
      void audit(ctx.db, {
        actorAddress: actor,
        actorType: "user",
        action: "task.move",
        resourceType: "task",
        resourceId: task.id,
        ip: ctx.ip ?? null,
        outcome: "success",
        metadata: { walletId: task.walletId, from: existing.status, to: input.status, position: task.position },
      });
      return annotate(task);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadTaskForWrite(ctx, input.id);
      const actor = requireSessionAddress(ctx);
      if (hasPendingPayout(existing)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This task has a payout awaiting signatures. Delete the pending transaction first.",
        });
      }
      await ctx.db.task.delete({ where: { id: input.id } });
      void audit(ctx.db, {
        actorAddress: actor,
        actorType: "user",
        action: "task.delete",
        resourceType: "task",
        resourceId: input.id,
        ip: ctx.ip ?? null,
        outcome: "success",
        metadata: { walletId: existing.walletId },
      });
      return { id: input.id };
    }),

  /**
   * Build the payout for the selected tasks and return what the human must
   * review: the summary, the fee, warnings, and the draft token that
   * `confirmPayout` accepts. Nothing is stored. A mutation rather than a
   * query: it reads chain state and mints a token.
   */
  preparePayout: protectedProcedure
    .input(z.object({ walletId: z.string(), taskIds: z.array(z.string()).min(1).max(MAX_PAYOUT_TASKS) }))
    .mutation(async ({ ctx, input }) => {
      await assertWalletAccess(ctx, input.walletId);
      const actor = requireSessionAddress(ctx);
      // Lazy: the pipeline pulls Mesh into the module graph.
      const [{ prepareTaskPayoutPreview }, { buildReviewDeps, toolContextFromSession }] = await Promise.all([
        import("@/lib/task-payout/preview"),
        import("@/lib/task-payout/deps"),
      ]);
      const toolCtx = toolContextFromSession(ctx);
      const result = await prepareTaskPayoutPreview(
        input,
        toolCtx,
        buildReviewDeps(ctx.db, toolCtx, { omitCard: true }),
      );
      void audit(ctx.db, {
        actorAddress: actor,
        actorType: "user",
        action: "task.payout.prepare",
        resourceType: "wallet",
        resourceId: input.walletId,
        ip: ctx.ip ?? null,
        outcome: result.status >= 400 ? "error" : "success",
        reason: result.status >= 400 ? String((result.body as { code?: string })?.code ?? result.status) : null,
        metadata: { taskIds: input.taskIds, ...(result.audit ?? {}) },
      });
      if (result.status >= 400) throw mapReviewError(result);
      const body = result.body as {
        draftToken: string;
        expiresAt: string;
        expiresInSeconds: number;
        txHash: string;
        fee: string;
        summary: unknown;
        warnings: string[];
        tasks: { id: string; title: string }[];
      };
      return {
        draftToken: body.draftToken,
        expiresAt: body.expiresAt,
        expiresInSeconds: body.expiresInSeconds,
        txHash: body.txHash,
        fee: body.fee,
        summary: body.summary as import("@/lib/tx-review/summary").TxReviewSummary,
        warnings: body.warnings,
        tasks: body.tasks,
        text: result.text ?? "",
      };
    }),

  /**
   * Create the previewed payout as a pending transaction with zero
   * signatures and link the tasks, all in one database transaction. Takes
   * only the draft token, so nothing can change between review and creation.
   */
  confirmPayout: protectedProcedure
    .input(z.object({ draftToken: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireSessionAddress(ctx);
      const [
        { verifyDraftToken, describeDraftTokenFailure },
        { runTransactionPropose },
        { withTaskPayoutHooks },
        { APP_CLIENT_ID, buildReviewDeps, toolContextFromSession },
      ] = await Promise.all([
        import("@/lib/tx-review/draft-token"),
        import("@/lib/tx-review/propose"),
        import("@/lib/task-payout/hooks"),
        import("@/lib/task-payout/deps"),
      ]);
      // Wallet access is asserted at the tRPC layer before the pipeline
      // re-checks signer membership: same answer, but the audit and error
      // shape match every other procedure here.
      const verified = verifyDraftToken(input.draftToken, { subject: actor, clientId: APP_CLIENT_ID });
      if (!verified.ok) {
        throw new TRPCError({
          code: verified.reason === "expired" ? "PRECONDITION_FAILED" : "BAD_REQUEST",
          message: describeDraftTokenFailure(verified.reason),
        });
      }
      await assertWalletAccess(ctx, verified.claims.walletId);

      const toolCtx = toolContextFromSession(ctx);
      const result = await runTransactionPropose(
        { draftToken: input.draftToken },
        toolCtx,
        withTaskPayoutHooks({
          ...buildReviewDeps(ctx.db, toolCtx, { omitCard: true }),
          via: "app",
          clientIp: ctx.ip,
        }),
      );
      void audit(ctx.db, {
        actorAddress: actor,
        actorType: "user",
        action: "task.payout.confirm",
        resourceType: "wallet",
        resourceId: verified.claims.walletId,
        ip: ctx.ip ?? null,
        outcome: result.status >= 400 ? "error" : "success",
        reason: result.status >= 400 ? String((result.body as { code?: string })?.code ?? result.status) : null,
        metadata: { taskIds: verified.claims.origin?.taskIds ?? [], ...(result.audit ?? {}) },
      });
      if (result.status >= 400) throw mapReviewError(result);
      const body = result.body as {
        transactionId: string;
        alreadyExisted: boolean;
        txHash: string;
        txHashChanged?: boolean;
        txHashChangeReasons?: string[];
        link: string;
        summary: unknown;
      };
      return {
        transactionId: body.transactionId,
        alreadyExisted: body.alreadyExisted,
        txHash: body.txHash,
        txHashChanged: body.txHashChanged ?? false,
        txHashChangeReasons: body.txHashChangeReasons ?? [],
        link: body.link,
        summary: body.summary as import("@/lib/tx-review/summary").TxReviewSummary,
        taskIds: verified.claims.origin?.taskIds ?? [],
      };
    }),
});
