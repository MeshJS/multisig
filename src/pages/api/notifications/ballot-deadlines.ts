import type { NextApiRequest, NextApiResponse } from "next";

import { db } from "@/server/db";
import { enqueueBallotDeadlineReminders } from "@/lib/notifications/ballotDeadlines";
import { notificationsEmailEnabled } from "@/lib/notifications/center";
import { drainNotificationOutbox } from "@/lib/notifications/worker";
import { authorizeSchedulerRequest } from "@/lib/notifications/schedulerAuth";

/**
 * Scheduled entry point (see .github/workflows/ballot-deadline-reminders.yml):
 * scans ballots for proposals whose voting deadline is within 48h, enqueues
 * reminder emails, then drains the outbox. Shares the drain secret.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!authorizeSchedulerRequest(req, res, "notifications/ballot-deadlines")) {
    return;
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
