import type { NextApiRequest, NextApiResponse } from "next";

import { env } from "@/env";
import { db } from "@/server/db";
import { drainNotificationOutbox } from "@/lib/notifications/worker";
import { notificationsEmailEnabled } from "@/lib/notifications/center";

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

  if (!notificationsEmailEnabled()) {
    return res.status(200).json({ drained: 0, emailEnabled: false });
  }

  const rawLimit = Array.isArray(req.query.limit)
    ? req.query.limit[0]
    : req.query.limit;
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : 25;
  const deliveries = await drainNotificationOutbox(db, {
    limit: Number.isFinite(limit) ? limit : 25,
  });

  return res.status(200).json({
    drained: deliveries.length,
    emailEnabled: true,
  });
}
