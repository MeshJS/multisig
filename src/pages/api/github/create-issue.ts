import { type NextApiRequest, type NextApiResponse } from "next";
import { Octokit } from "@octokit/core";
import { env } from "@/env";
import { getWalletSessionFromReq } from "@/lib/auth/walletSession";
import { applyStrictRateLimit, enforceBodySize } from "@/lib/security/requestGuards";

/**
 * POST /api/github/create-issue — the in-app "Create a ticket" dialog.
 *
 * Every request becomes a public issue on MeshJS/multisig, written with the
 * project's GITHUB_TOKEN. This endpoint used to accept any method from anyone
 * with no limit, so a script could flood the repo with issues and, because
 * `type` went straight into `labels`, attach (and with a push-scoped token,
 * create) arbitrary labels. It now takes only POST, from a caller holding the
 * app's wallet session (the dialog is shown to signed-in users only), at a few
 * reports per IP per window, with bounded, validated fields. The session cookie
 * is SameSite=Lax, so another site cannot file reports through a visitor's
 * browser either — no separate Origin check, which would depend on CORS_ORIGINS
 * listing the app's own origin.
 */

// GitHub caps titles at 256 characters; a report needs far less than either.
export const MAX_TITLE_LENGTH = 200;
export const MAX_BODY_LENGTH = 5000;
const MAX_REQUEST_BYTES = 16 * 1024;
// A person filing reports by hand never comes near this; a script does at once.
const REPORTS_PER_WINDOW = 5;
const REPORT_WINDOW_MS = 10 * 60 * 1000;

export const ISSUE_TYPES = ["bug", "enhancement"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export type IssueReport = { title: string; body: string; type: IssueType };

/**
 * Validate the dialog's payload. Returns the trimmed report, or the reason it
 * was rejected, so the handler can answer 400 instead of letting GitHub (or
 * Octokit, on a missing title) fail with a 500.
 */
export function parseIssueReport(
  input: unknown,
): { ok: true; report: IssueReport } | { ok: false; error: string } {
  const raw = (input ?? {}) as Record<string, unknown>;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  const type = raw.type;

  if (!title) return { ok: false, error: "title is required" };
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: `title must be at most ${MAX_TITLE_LENGTH} characters` };
  }
  if (!body) return { ok: false, error: "body is required" };
  if (body.length > MAX_BODY_LENGTH) {
    return { ok: false, error: `body must be at most ${MAX_BODY_LENGTH} characters` };
  }
  if (typeof type !== "string" || !(ISSUE_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: `type must be one of: ${ISSUE_TYPES.join(", ")}` };
  }
  return { ok: true, report: { title, body, type: type as IssueType } };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!env.GITHUB_TOKEN) {
    return res.status(503).json({ error: "GitHub integration not configured" });
  }
  if (!enforceBodySize(req, res, MAX_REQUEST_BYTES)) {
    return;
  }

  const session = getWalletSessionFromReq(req);
  if ((session?.wallets?.length ?? 0) === 0) {
    return res
      .status(401)
      .json({ error: "Unauthorized - connect and authorize a wallet first" });
  }

  const parsed = parseIssueReport(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }
  // Counted only once a report would actually be filed, so a user who hits
  // "title is required" a few times is not locked out of reporting.
  if (
    !applyStrictRateLimit(req, res, {
      keySuffix: "github/create-issue",
      maxRequests: REPORTS_PER_WINDOW,
      windowMs: REPORT_WINDOW_MS,
    })
  ) {
    return;
  }
  const { title, body, type } = parsed.report;

  const octokit = new Octokit({ auth: env.GITHUB_TOKEN });
  try {
    await octokit.request("POST /repos/{owner}/{repo}/issues", {
      owner: "MeshJS",
      repo: "multisig",
      title,
      body: `${body}\n\nSubmitted via web form.`,
      assignees: [],
      labels: [type],
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (error) {
    // GitHub's error text can describe the token's permissions; keep it in the logs.
    console.error("GitHub issue creation failed:", error);
    return res.status(502).json({ error: "Could not create the issue on GitHub" });
  }

  return res.status(200).json(true);
}
