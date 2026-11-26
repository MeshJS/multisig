import type { NextApiRequest, NextApiResponse } from "next";

import { db } from "@/server/db";
import { drainNotificationOutbox } from "@/lib/notifications/worker";
import { notificationsEmailEnabled } from "@/lib/notifications/center";
import { authorizeSchedulerRequest } from "@/lib/notifications/schedulerAuth";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!authorizeSchedulerRequest(req, res, "notifications/drain")) {
    return;
  }

  if (!notificationsEmailEnabled()) {
    return res.status(200).json({ drained: 0, emailEnabled: false });
  }

  const rawLimit = Array.isArray(req.query.limit)
    ? req.query.limit[0]
    : req.query.limit;
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : 25;
  // Caught so a failed drain answers with JSON the workflow log can show, the
  // same shape ballot-deadlines already returns, rather than Next's bare 500.
  try {
    const deliveries = await drainNotificationOutbox(db, {
      limit: Number.isFinite(limit) ? limit : 25,
    });
    return res.status(200).json({
      drained: deliveries.length,
      emailEnabled: true,
    });
  } catch (error) {
    console.error("Notification outbox drain failed", error);
    return res.status(500).json({ error: "Notification outbox drain failed" });
  }
}
