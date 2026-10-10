import type { NextApiRequest, NextApiResponse } from "next";

import { buildBotSetupGuide } from "@/lib/botSetupGuide";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  const guide = buildBotSetupGuide();
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).send(guide);
}
