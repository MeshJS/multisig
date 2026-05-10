/**
 * Append-only AuditLog emitter.
 *
 * Use for security-relevant events: auth flows, privilege grants, wallet
 * mutations, signing actions. Failures to write are logged but never thrown —
 * an audit miss must not break the user-facing flow.
 */

import type { PrismaClient } from "@prisma/client";
import { logger, redact } from "./logger";

export type AuditOutcome = "success" | "denied" | "error";
export type AuditActorType = "user" | "bot" | "system";

export type AuditEvent = {
  actorAddress?: string | null;
  actorType: AuditActorType;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  outcome: AuditOutcome;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

export async function audit(db: PrismaClient, event: AuditEvent): Promise<void> {
  try {
    const safeMetadata =
      event.metadata !== undefined
        ? (redact(event.metadata) as Record<string, unknown>)
        : undefined;
    await db.auditLog.create({
      data: {
        actorAddress: event.actorAddress ?? null,
        actorType: event.actorType,
        action: event.action,
        resourceType: event.resourceType ?? null,
        resourceId: event.resourceId ?? null,
        ip: event.ip ?? null,
        userAgent: event.userAgent ?? null,
        outcome: event.outcome,
        reason: event.reason ?? null,
        metadata: safeMetadata as never,
      },
    });
  } catch (err) {
    logger.warn("audit.emit_failed", {
      action: event.action,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
