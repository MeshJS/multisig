import type { NextApiRequest, NextApiResponse } from "next";
import { resumeTestRun, startTestRun } from "@/server/test-agent/runner";
import { normalizeProviderHint } from "@/server/test-agent/provider";

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

  const {
    networkId,
    amountLovelace,
    poolId,
    refAddress,
    providerHint,
    resumeRunId,
  } = req.body ?? {};

  if (typeof resumeRunId === "string" && resumeRunId.trim()) {
    try {
      const run = resumeTestRun(resumeRunId.trim());
      res.status(200).json({ runId: run.id, resumed: true });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to resume run",
      });
    }
    return;
  }

  if (typeof networkId !== "number") {
    res.status(400).json({ error: "Missing networkId" });
    return;
  }

  const run = startTestRun({
    networkId,
    amountLovelace: typeof amountLovelace === "number" ? amountLovelace : undefined,
    poolId: typeof poolId === "string" && poolId.trim() ? poolId.trim() : undefined,
    refAddress:
      typeof refAddress === "string" && refAddress.trim() ? refAddress.trim() : undefined,
    providerHint: normalizeProviderHint(providerHint),
  });

  res.status(200).json({ runId: run.id });
}
