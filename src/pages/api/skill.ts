import type { NextApiRequest, NextApiResponse } from "next";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const SKILL_PATH = join(process.cwd(), ".cursor", "skills", "multisig", "SKILL.md");
const FILENAME = "multisig-skill.md";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!existsSync(SKILL_PATH)) {
    return res.status(404).json({ error: "Skill file not found" });
  }

  try {
    const content = readFileSync(SKILL_PATH, "utf8");
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${FILENAME}"`);
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).send(content);
  } catch (e) {
    console.error("Skill download error:", e);
    return res.status(500).json({ error: "Failed to read skill file" });
  }
}
