import { type NextApiRequest, type NextApiResponse } from "next";
import { Octokit } from "@octokit/core";
import { env } from "@/env";

interface Request extends NextApiRequest {
  body: {
    title: string;
    body: string;
    type: "bug" | "enhancement";
  };
}

export default async function handler(req: Request, res: NextApiResponse) {
  if (!env.GITHUB_TOKEN) {
    return res.status(503).json({ error: "GitHub integration not configured" });
  }

  const octokit = new Octokit({
    auth: env.GITHUB_TOKEN,
  });

  await octokit.request("POST /repos/{owner}/{repo}/issues", {
    owner: "MeshJS",
    repo: "multisig",
    title: req.body.title,
    body: `${req.body.body}\n\nSubmitted via web form.`,
    assignees: [],
    labels: [req.body.type],
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  res.status(200).json(true);
}
