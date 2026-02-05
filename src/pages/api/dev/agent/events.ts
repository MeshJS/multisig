import type { NextApiRequest, NextApiResponse } from "next";
import { getEvents, subscribeToEvents } from "@/server/test-agent/state";

const isDevEnabled = () =>
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_ENABLE_TEST_AGENT === "true";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isDevEnabled()) {
    res.status(403).json({ error: "Test agent is disabled" });
    return;
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const runId = Array.isArray(req.query.runId) ? req.query.runId[0] : req.query.runId;

  if (!runId || typeof runId !== "string") {
    res.status(400).json({ error: "Missing runId" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  res.write("retry: 2000\n\n");

  const existing = getEvents(runId);
  existing.forEach((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  const unsubscribe = subscribeToEvents(runId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  req.on("close", () => {
    unsubscribe();
    res.end();
  });
}
