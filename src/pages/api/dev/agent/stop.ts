import type { NextApiRequest, NextApiResponse } from "next";
import { cancelRun } from "@/server/test-agent/runner";

const isDevEnabled = () =>
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_ENABLE_TEST_AGENT === "true";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isDevEnabled()) {
    res.status(403).json({ error: "Test agent is disabled" });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { runId } = req.body ?? {};

  if (!runId || typeof runId !== "string") {
    res.status(400).json({ error: "Missing runId" });
    return;
  }

  cancelRun(runId);
  res.status(200).json({ ok: true });
}
