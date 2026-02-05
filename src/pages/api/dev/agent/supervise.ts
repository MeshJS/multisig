import type { NextApiRequest, NextApiResponse } from "next";
import { cancelRun, resumeTestRun } from "@/server/test-agent/runner";
import { getEvents, getRun, listRuns } from "@/server/test-agent/state";
import type { AgentEvent, RunRecord, RunStatus } from "@/server/test-agent/types";

const isDevEnabled = () =>
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_ENABLE_TEST_AGENT === "true";

const MAX_EVENT_LIMIT = 500;
const DEFAULT_EVENT_LIMIT = 100;

const normalizeEventLimit = (raw: unknown) => {
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(Math.floor(parsed), MAX_EVENT_LIMIT);
    }
  }
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(Math.floor(raw), MAX_EVENT_LIMIT);
  }
  return DEFAULT_EVENT_LIMIT;
};

const parseStatusFilter = (raw: string | string[] | undefined): RunStatus[] | null => {
  if (!raw) return null;
  const rawValue = Array.isArray(raw) ? raw.join(",") : raw;
  const tokens = rawValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const allowed: RunStatus[] = ["running", "completed", "failed", "cancelled"];
  const selected = tokens.filter((token): token is RunStatus =>
    (allowed as string[]).includes(token),
  );
  return selected.length > 0 ? selected : null;
};

const getAvailableActions = (status?: RunStatus) => {
  if (status === "running") return ["cancel"];
  if (status === "failed" || status === "cancelled") return ["resume"];
  return [];
};

const getLastEvent = (events: AgentEvent[]) =>
  events.length > 0 ? events[events.length - 1] : null;

const getLastError = (events: AgentEvent[]) => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]?.type === "error") return events[i];
  }
  return null;
};

const buildRunSnapshot = (
  run: RunRecord,
  events: AgentEvent[],
  eventLimit: number,
) => {
  const limitedEvents = eventLimit < events.length ? events.slice(-eventLimit) : events;
  return {
    run,
    events: limitedEvents,
    lastEvent: getLastEvent(events),
    lastError: getLastError(events),
    availableActions: getAvailableActions(run.status),
  };
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isDevEnabled()) {
    res.status(403).json({ error: "Test agent is disabled" });
    return;
  }

  if (req.method === "GET") {
    const runId = Array.isArray(req.query.runId) ? req.query.runId[0] : req.query.runId;
    const eventLimit = normalizeEventLimit(
      Array.isArray(req.query.eventLimit)
        ? req.query.eventLimit[0]
        : req.query.eventLimit,
    );

    if (runId) {
      const run = getRun(runId);
      if (!run) {
        res.status(404).json({ error: "Run not found" });
        return;
      }
      const events = getEvents(runId);
      res.status(200).json(buildRunSnapshot(run, events, eventLimit));
      return;
    }

    const statusFilter = parseStatusFilter(req.query.status);
    const runs = listRuns().filter((run) =>
      statusFilter ? statusFilter.includes(run.status) : true,
    );

    const summaries = runs.map((run) => {
      const events = getEvents(run.id);
      return buildRunSnapshot(run, events, eventLimit);
    });

    res.status(200).json({ runs: summaries });
    return;
  }

  if (req.method === "POST") {
    const { runId, action } = req.body ?? {};

    if (!runId || typeof runId !== "string") {
      res.status(400).json({ error: "Missing runId" });
      return;
    }

    if (action !== "resume" && action !== "cancel") {
      res.status(400).json({ error: "Invalid action" });
      return;
    }

    const run = getRun(runId);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }

    if (action === "resume") {
      if (run.status !== "failed" && run.status !== "cancelled") {
        res.status(409).json({ error: "Run is not resumable" });
        return;
      }
      try {
        resumeTestRun(runId);
      } catch (error) {
        res.status(400).json({
          error: error instanceof Error ? error.message : "Failed to resume run",
        });
        return;
      }
      const updated = getRun(runId);
      res.status(200).json({ runId, status: updated?.status ?? "running" });
      return;
    }

    if (run.status !== "running") {
      res.status(409).json({ error: "Run is not running" });
      return;
    }

    cancelRun(runId);
    const updated = getRun(runId);
    res.status(200).json({ runId, status: updated?.status ?? "cancelled" });
    return;
  }

  res.setHeader("Allow", "GET, POST");
  res.status(405).json({ error: "Method not allowed" });
}
