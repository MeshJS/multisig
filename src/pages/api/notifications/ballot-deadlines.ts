import type { NextApiRequest, NextApiResponse } from "next";

import { env } from "@/env";
import { db } from "@/server/db";
import { enqueueBallotDeadlineReminders } from "@/lib/notifications/ballotDeadlines";
import { notificationsEmailEnabled } from "@/lib/notifications/center";
import { drainNotificationOutbox } from "@/lib/notifications/worker";

/**
 * Scheduled entry point (see .github/workflows/ballot-deadline-reminders.yml):
 * scans ballots for proposals whose voting deadline is within 48h, enqueues
 * reminder emails, then drains the outbox. Shares the drain secret.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!env.NOTIFICATION_DRAIN_SECRET) {
    return res.status(503).json({ error: "Notification drain is not configured" });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (token !== env.NOTIFICATION_DRAIN_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Skip the chain lookups entirely when nothing could be sent anyway.
  if (!notificationsEmailEnabled()) {
    return res.status(200).json({ emailEnabled: false, remindersEnqueued: 0, drained: 0 });
  }

  try {
    const scan = await enqueueBallotDeadlineReminders(db);
    const deliveries =
      scan.remindersEnqueued > 0
        ? await drainNotificationOutbox(db, { limit: 100 })
        : [];
    return res.status(200).json({
      emailEnabled: true,
      ...scan,
      drained: deliveries.length,
    });
  } catch (error) {
    console.error("Ballot deadline reminder scan failed", error);
    return res.status(500).json({ error: "Ballot deadline reminder scan failed" });
  }
}
