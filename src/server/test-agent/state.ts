import type { AgentEvent, RunConfig, RunRecord, RunStatus } from "./types";
import fs from "fs";
import path from "path";

const MAX_EVENTS = 500;
const STORE_PATH = path.resolve(process.cwd(), ".local", "test-agent-store.json");
const jsonReplacer = (_key: string, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value;

type EventSubscriber = (event: AgentEvent) => void;

type AgentStore = {
  runs: Map<string, RunRecord>;
  events: Map<string, AgentEvent[]>;
  subscribers: Map<string, Set<EventSubscriber>>;
};

declare global {
  // eslint-disable-next-line no-var
  var __testAgentStore: AgentStore | undefined;
}

const createStore = (): AgentStore => ({
  runs: new Map(),
  events: new Map(),
  subscribers: new Map(),
});

const ensureStoreDir = () => {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const loadStore = (): AgentStore => {
  const store = createStore();
  try {
    if (!fs.existsSync(STORE_PATH)) {
      return store;
    }
    const raw = fs.readFileSync(STORE_PATH, "utf-8");
    const data = JSON.parse(raw) as {
      runs?: RunRecord[];
      events?: Record<string, AgentEvent[]>;
    };
    if (Array.isArray(data.runs)) {
      data.runs.forEach((run) => {
        if (run?.id) store.runs.set(run.id, run);
      });
    }
    if (data.events) {
      Object.entries(data.events).forEach(([runId, events]) => {
        if (Array.isArray(events)) {
          store.events.set(runId, events.slice(-MAX_EVENTS));
        }
      });
    }
  } catch {
    // Ignore load errors; fall back to empty store
  }
  return store;
};

export const loadStoreSnapshot = (): {
  runs: RunRecord[];
  events: Record<string, AgentEvent[]>;
} => {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      return { runs: [], events: {} };
    }
    const raw = fs.readFileSync(STORE_PATH, "utf-8");
    const data = JSON.parse(raw) as {
      runs?: RunRecord[];
      events?: Record<string, AgentEvent[]>;
    };
    const runs = Array.isArray(data.runs) ? data.runs : [];
    const events: Record<string, AgentEvent[]> = {};
    if (data.events) {
      Object.entries(data.events).forEach(([runId, runEvents]) => {
        if (Array.isArray(runEvents)) {
          events[runId] = runEvents.slice(-MAX_EVENTS);
        }
      });
    }
    return { runs, events };
  } catch {
    return { runs: [], events: {} };
  }
};

let persistTimer: NodeJS.Timeout | null = null;

const persistStore = (store: AgentStore) => {
  try {
    ensureStoreDir();
    const payload = {
      runs: Array.from(store.runs.values()),
      events: Object.fromEntries(store.events),
    };
    fs.writeFileSync(STORE_PATH, JSON.stringify(payload, jsonReplacer, 2));
  } catch {
    // Ignore persistence failures in dev
  }
};

const schedulePersist = (store: AgentStore) => {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistStore(store);
  }, 200);
};

const getStore = (): AgentStore => {
  if (!global.__testAgentStore) {
    global.__testAgentStore = loadStore();
  }
  return global.__testAgentStore;
};

const generateId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `run_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

export const createRun = (config: RunConfig): RunRecord => {
  const store = getStore();
  const runId = generateId();
  const run: RunRecord = {
    id: runId,
    status: "running",
    config,
    startedAt: Date.now(),
  };
  store.runs.set(runId, run);
  store.events.set(runId, []);
  schedulePersist(store);
  return run;
};

export const getRun = (runId: string): RunRecord | undefined => {
  const store = getStore();
  return store.runs.get(runId);
};

export const updateRun = (runId: string, patch: Partial<RunRecord>): RunRecord | undefined => {
  const store = getStore();
  const run = store.runs.get(runId);
  if (!run) return undefined;
  const updated = { ...run, ...patch };
  store.runs.set(runId, updated);
  schedulePersist(store);
  return updated;
};

export const setRunStatus = (runId: string, status: RunStatus, error?: string): RunRecord | undefined => {
  const patch: Partial<RunRecord> = { status };
  if (status === "completed" || status === "failed" || status === "cancelled") {
    patch.endedAt = Date.now();
  }
  if (error) {
    patch.error = error;
  }
  return updateRun(runId, patch);
};

export const addEvent = (runId: string, event: AgentEvent) => {
  const store = getStore();
  const runEvents = store.events.get(runId) ?? [];
  runEvents.push(event);
  if (runEvents.length > MAX_EVENTS) {
    runEvents.splice(0, runEvents.length - MAX_EVENTS);
  }
  store.events.set(runId, runEvents);
  schedulePersist(store);

  const listeners = store.subscribers.get(runId);
  if (listeners) {
    listeners.forEach((listener) => listener(event));
  }
};

export const getEvents = (runId: string): AgentEvent[] => {
  const store = getStore();
  return store.events.get(runId) ?? [];
};

export const listRuns = (): RunRecord[] => {
  const store = getStore();
  return Array.from(store.runs.values()).sort((a, b) => b.startedAt - a.startedAt);
};

export const subscribeToEvents = (runId: string, listener: EventSubscriber) => {
  const store = getStore();
  const set = store.subscribers.get(runId) ?? new Set<EventSubscriber>();
  set.add(listener);
  store.subscribers.set(runId, set);
  return () => {
    const current = store.subscribers.get(runId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      store.subscribers.delete(runId);
    }
  };
};

export const ensureRun = (runId: string): RunRecord => {
  const run = getRun(runId);
  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }
  return run;
};
