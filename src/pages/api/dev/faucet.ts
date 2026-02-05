import type { NextApiRequest, NextApiResponse } from "next";
import { sendFaucetFunds } from "@/server/test-agent/faucet";

const isDevEnabled = () =>
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_ENABLE_TEST_AGENT === "true";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isDevEnabled()) {
    res.status(403).json({ error: "Test agent is disabled" });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { address, amountLovelace, networkId } = req.body ?? {};

  if (!address || typeof address !== "string") {
    res.status(400).json({ error: "Missing address" });
    return;
  }

  if (typeof amountLovelace !== "number") {
    res.status(400).json({ error: "Missing amountLovelace" });
    return;
  }

  if (typeof networkId !== "number") {
    res.status(400).json({ error: "Missing networkId" });
    return;
  }

  try {
    const result = await sendFaucetFunds({ address, amountLovelace, networkId });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Faucet failed",
    });
  }
}
