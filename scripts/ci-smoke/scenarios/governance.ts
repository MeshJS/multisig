import type { Context, ScenarioResult } from "./types";

export async function governanceScenario(ctx: Context): Promise<ScenarioResult> {
  const start = Date.now();
  try {
    const base = ctx.baseUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/api/v1/governanceActiveProposals`, {
      headers: { Authorization: `Bearer ${ctx.botToken}` },
    });

    if (!res.ok) {
      return {
        name: "governance",
        passed: false,
        critical: false,
        message: `governanceActiveProposals returned ${res.status}: ${await res.text()}`,
        durationMs: Date.now() - start,
      };
    }

    const data = (await res.json()) as { proposals?: unknown[] } | unknown[];
    const proposals = Array.isArray(data)
      ? data
      : Array.isArray((data as { proposals?: unknown[] }).proposals)
        ? (data as { proposals: unknown[] }).proposals
        : null;

    if (proposals === null) {
      return {
        name: "governance",
        passed: false,
        critical: false,
        message: "governanceActiveProposals did not return proposals array",
        durationMs: Date.now() - start,
      };
    }

    return {
      name: "governance",
      passed: true,
      critical: false,
      message: `Found ${proposals.length} active proposals`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "governance",
      passed: false,
      critical: false,
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}
