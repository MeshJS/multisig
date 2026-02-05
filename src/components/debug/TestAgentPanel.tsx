"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";
import { useNetwork, useWallet } from "@meshsdk/react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { getProvider } from "@/utils/get-provider";
import { MeshTxBuilder } from "@meshsdk/core";
import { useToast } from "@/hooks/use-toast";
import { TxConfirmationProgress } from "@/components/crowdfund/UI/useCollateralToast";
import { Grip, Loader2, RefreshCw } from "lucide-react";

const GOV_STATES = [
  "Init Wallet",
  "Faucet Funded",
  "Collateral Ready",
  "Crowdfund",
  "Contributed",
  "Withdrawn",
  "RegisteredCerts",
  "Proposed",
  "Voted",
  "Refundable",
] as const;

type GovState = (typeof GOV_STATES)[number];

type AgentEvent = {
  id: string;
  runId: string;
  ts: number;
  type: string;
  message?: string;
  data?: Record<string, unknown>;
};

type RunSummary = {
  run: {
    id: string;
    status: string;
    startedAt: number;
    endedAt?: number;
    currentState?: string;
    config?: { networkId?: number };
  };
  lastEvent?: AgentEvent | null;
  lastError?: AgentEvent | null;
  availableActions?: string[];
};

type StepStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

type StepDefinition = {
  key: string;
  label: string;
  start: string;
  end: string;
  help: string;
};

type JobStep = StepDefinition & {
  status: StepStatus;
  startedAt: number | null;
  endedAt: number | null;
  logs: AgentEvent[];
  error: AgentEvent | null;
};

const STEP_DEFINITIONS: StepDefinition[] = [
  {
    key: "init-wallet",
    label: "Initialize wallet",
    start: "Initialize wallet",
    end: "Wallet initialized",
    help: "Derive the agent wallet and resolve the payment address.",
  },
  {
    key: "faucet-funds",
    label: "Request faucet funds",
    start: "Request faucet funds",
    end: "Faucet funds confirmed",
    help: "Fund the agent wallet and wait for transaction confirmation.",
  },
  {
    key: "collateral",
    label: "Setup collateral",
    start: "Setup collateral",
    end: "Collateral confirmed",
    help: "Create collateral UTxO for contract interactions.",
  },
  {
    key: "crowdfund-setup",
    label: "Setup crowdfund",
    start: "Setup crowdfund",
    end: "Crowdfund setup confirmed",
    help: "Create the crowdfund UTxO and record metadata.",
  },
  {
    key: "contribute",
    label: "Contribute to crowdfund",
    start: "Contribute to crowdfund",
    end: "Contribution confirmed",
    help: "Send a contribution and update the crowdfund datum.",
  },
  {
    key: "withdraw",
    label: "Withdraw from crowdfund",
    start: "Withdraw from crowdfund",
    end: "Withdrawal confirmed",
    help: "Withdraw from the crowdfund and update balances.",
  },
];

const STORAGE_KEY = "test-agent-config:v1";

const mergeEventsById = (current: AgentEvent[], incoming: AgentEvent[]) => {
  if (incoming.length === 0) return current;
  const merged = new Map<string, AgentEvent>();
  current.forEach((evt) => merged.set(evt.id, evt));
  incoming.forEach((evt) => merged.set(evt.id, evt));
  return Array.from(merged.values()).sort((a, b) => a.ts - b.ts);
};

const formatTime = (timestamp?: number | null) => {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleTimeString();
};

const formatDuration = (ms?: number | null) => {
  if (!ms || ms < 0) return "-";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const formatAdaFromLovelace = (lovelace?: string | null) => {
  if (!lovelace) return "-";
  try {
    const value = BigInt(lovelace);
    const whole = value / 1_000_000n;
    const frac = value % 1_000_000n;
    const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
    return fracStr ? `${whole.toString()}.${fracStr} ADA` : `${whole.toString()} ADA`;
  } catch {
    return "-";
  }
};

const sumLovelaceFromUtxos = (utxos: any[]): bigint => {
  return utxos.reduce((sum, utxo) => {
    const amount =
      utxo?.output?.amount ??
      utxo?.amount ??
      utxo?.value?.amount ??
      [];
    if (!Array.isArray(amount)) return sum;
    const lovelace = amount.find((asset: any) => asset?.unit === "lovelace");
    return sum + BigInt(lovelace?.quantity || "0");
  }, 0n);
};

const parseLovelace = (value: unknown): bigint | null => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.round(value));
  }
  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim();
    if (/^\d+$/.test(normalized)) {
      return BigInt(normalized);
    }
  }
  return null;
};

const getStatusClasses = (status: string) => {
  switch (status) {
    case "running":
      return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
    case "completed":
      return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
    case "failed":
      return "bg-red-500/10 text-red-600 border-red-500/20";
    case "cancelled":
      return "bg-amber-500/10 text-amber-600 border-amber-500/20";
    case "starting":
      return "bg-sky-500/10 text-sky-600 border-sky-500/20";
    default:
      return "bg-muted text-muted-foreground border-border/60";
  }
};

const getStepStatusClasses = (status: StepStatus) => {
  switch (status) {
    case "running":
      return "bg-sky-500/10 text-sky-600 border-sky-500/20";
    case "completed":
      return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
    case "failed":
      return "bg-red-500/10 text-red-600 border-red-500/20";
    case "cancelled":
      return "bg-amber-500/10 text-amber-600 border-amber-500/20";
    case "pending":
    default:
      return "bg-muted text-muted-foreground border-border/60";
  }
};

const getEventClasses = (type: string) => {
  switch (type) {
    case "run_started":
    case "run_resumed":
    case "step_started":
      return "bg-sky-500/10 text-sky-600";
    case "step_completed":
    case "run_completed":
      return "bg-emerald-500/10 text-emerald-600";
    case "run_cancelled":
      return "bg-amber-500/10 text-amber-600";
    case "error":
      return "bg-red-500/10 text-red-600";
    case "state_changed":
      return "bg-violet-500/10 text-violet-600";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const StateNode = ({ data }: NodeProps<{ label: string; active?: boolean }>) => {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-xs font-semibold shadow-sm",
        data.active
          ? "border-emerald-400 bg-emerald-500 text-white"
          : "border-border bg-muted/70 text-foreground",
      )}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <Handle type="source" position={Position.Right} className="opacity-0" />
      <div className="flex items-center gap-2">
        <span>{data.label}</span>
        {data.active && <span className="h-2 w-2 rounded-full bg-white animate-pulse" />}
      </div>
    </div>
  );
};

const NODE_TYPES = { stateNode: StateNode };

export default function TestAgentPanel() {
  const networkId = useNetwork();
  const { wallet, connected } = useWallet();
  const [open, setOpen] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [activeState, setActiveState] = useState<GovState>("Init Wallet");
  const [faucetAddress, setFaucetAddress] = useState<string | null>(null);
  const [agentAddress, setAgentAddress] = useState<string | null>(null);
  const [faucetBalance, setFaucetBalance] = useState<string | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [configDefaults, setConfigDefaults] = useState<{
    poolId?: string;
    refAddress?: string;
  } | null>(null);
  const [poolId, setPoolId] = useState("");
  const [refAddress, setRefAddress] = useState("");
  const [storedConfig, setStoredConfig] = useState({ poolId: "", refAddress: "" });
  const [hasStoredConfig, setHasStoredConfig] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [autoFilledDefaults, setAutoFilledDefaults] = useState(false);
  const [fundAmountAda, setFundAmountAda] = useState<string>("10");
  const [funding, setFunding] = useState(false);
  const [fundTxHash, setFundTxHash] = useState<string | null>(null);
  const [fundConfirmingTxHash, setFundConfirmingTxHash] = useState<string | null>(null);
  const [fundError, setFundError] = useState<string | null>(null);
  const [faucetBalanceLoading, setFaucetBalanceLoading] = useState(false);
  const [showEventData, setShowEventData] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [runEndedAt, setRunEndedAt] = useState<number | null>(null);
  const [resumeCandidate, setResumeCandidate] = useState<RunSummary | null>(null);
  const [resumeLoading, setResumeLoading] = useState(false);
  const { toast } = useToast();
  const [panelSize, setPanelSize] = useState({ width: 480, height: 760 });
  const [isResizing, setIsResizing] = useState(false);
  const resizingRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { poolId?: string; refAddress?: string };
        const next = {
          poolId: typeof parsed.poolId === "string" ? parsed.poolId : "",
          refAddress: typeof parsed.refAddress === "string" ? parsed.refAddress : "",
        };
        setPoolId(next.poolId);
        setRefAddress(next.refAddress);
        setStoredConfig(next);
        setHasStoredConfig(true);
      } catch {
        // Ignore invalid storage
      }
    }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady || hasStoredConfig || autoFilledDefaults) return;
    if (!configDefaults) return;
    let didSet = false;
    if (!poolId && configDefaults.poolId) {
      setPoolId(configDefaults.poolId);
      didSet = true;
    }
    if (!refAddress && configDefaults.refAddress) {
      setRefAddress(configDefaults.refAddress);
      didSet = true;
    }
    if (didSet) setAutoFilledDefaults(true);
  }, [storageReady, hasStoredConfig, autoFilledDefaults, configDefaults, poolId, refAddress]);

  const trimmedPoolId = poolId.trim();
  const trimmedRefAddress = refAddress.trim();
  const storedPoolId = storedConfig.poolId.trim();
  const storedRefAddress = storedConfig.refAddress.trim();
  const configDirty =
    trimmedPoolId !== storedPoolId || trimmedRefAddress !== storedRefAddress;
  const effectivePoolId = trimmedPoolId || configDefaults?.poolId || "";
  const effectiveRefAddress = trimmedRefAddress || configDefaults?.refAddress || "";
  const missingPoolId = !effectivePoolId;
  const missingRefAddress = !effectiveRefAddress;
  const configReady = !missingPoolId && !missingRefAddress;
  const poolIdWarning = trimmedPoolId.length > 0 && !trimmedPoolId.startsWith("pool");
  const refAddressWarning =
    trimmedRefAddress.length > 0 && !trimmedRefAddress.startsWith("addr");
  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const canResumeCandidate = resumeCandidate?.availableActions
    ? resumeCandidate.availableActions.includes("resume")
    : true;
  const durationMs = runStartedAt
    ? (runEndedAt ?? Date.now()) - runStartedAt
    : null;
  const providerHint = useMemo(() => {
    if (typeof networkId !== "number") return undefined;
    try {
      const provider = getProvider(networkId);
      const name = provider?.constructor?.name?.toLowerCase() ?? "";
      if (name.includes("koios")) return "koios";
      if (name.includes("blockfrost")) return "blockfrost";
    } catch {
      // ignore
    }
    return undefined;
  }, [networkId]);
  const minWidth = 420;
  const minHeight = 560;

  const jobSteps = useMemo<JobStep[]>(() => {
    const steps = STEP_DEFINITIONS.map((def) => ({
      ...def,
      status: "pending" as StepStatus,
      startedAt: null,
      endedAt: null,
      logs: [] as AgentEvent[],
      error: null as AgentEvent | null,
    }));
    const byStart = new Map(STEP_DEFINITIONS.map((def) => [def.start, def.key]));
    const byEnd = new Map(STEP_DEFINITIONS.map((def) => [def.end, def.key]));
    const byKey = new Map(steps.map((step, index) => [step.key, index]));
    let currentKey: string | null = null;

    for (const evt of events) {
      if (evt.type === "step_started" && evt.message) {
        const key = byStart.get(evt.message);
        if (key !== undefined) {
          const step = steps[byKey.get(key)!];
          step.status = "running";
          step.startedAt = step.startedAt ?? evt.ts;
          currentKey = key;
        }
      }

      if (evt.type === "step_completed" && evt.message) {
        const key = byEnd.get(evt.message);
        if (key !== undefined) {
          const step = steps[byKey.get(key)!];
          step.status = "completed";
          step.endedAt = evt.ts;
          if (currentKey === key) currentKey = null;
        }
      }

      if (evt.type === "run_cancelled" && currentKey) {
        const step = steps[byKey.get(currentKey)!];
        step.status = "cancelled";
        step.endedAt = evt.ts;
        currentKey = null;
      }

      if (evt.type === "error" && currentKey) {
        const step = steps[byKey.get(currentKey)!];
        step.status = "failed";
        step.endedAt = evt.ts;
        step.error = evt;
        currentKey = null;
      }

      if (currentKey && (evt.type === "log" || evt.type === "error")) {
        const step = steps[byKey.get(currentKey)!];
        step.logs.push(evt);
      }
    }

    return steps;
  }, [events]);

  const lastErrorEvent = useMemo(
    () => [...events].reverse().find((evt) => evt.type === "error"),
    [events],
  );

  const getEventDetails = useCallback((evt?: AgentEvent) => {
    if (!evt?.data) return [] as { label: string; value: string }[];
    const data = evt.data as Record<string, unknown>;
    const details: { label: string; value: string }[] = [];
    const push = (label: string, value: unknown) => {
      if (value === undefined || value === null || value === "") return;
      details.push({ label, value: String(value) });
    };

    push("Network", data.networkId);
    push("Provider", data.provider);
    push("Faucet address", data.faucetAddress);
    push("Agent address", data.walletAddress);
    push("Tx hash", data.txHash);
    push("Crowdfund ID", data.crowdfundId);

    const requested = data.requestedAmount ?? data.amountLovelace;
    const requestedLov = parseLovelace(requested);
    const totalLov = parseLovelace(data.totalLovelace);
    const minLov = parseLovelace(data.minBalance);

    if (requestedLov !== null) {
      push("Requested", formatAdaFromLovelace(requestedLov.toString()));
    }
    if (totalLov !== null) {
      push("Faucet balance", formatAdaFromLovelace(totalLov.toString()));
    }
    if (minLov !== null) {
      push("Min reserve", formatAdaFromLovelace(minLov.toString()));
    }

    if (totalLov !== null && minLov !== null) {
      const available = totalLov - minLov;
      const sendable = available > 0n ? available : 0n;
      push("Available to send", formatAdaFromLovelace(sendable.toString()));

      if (requestedLov !== null) {
        const requiredTotal = minLov + requestedLov;
        if (requiredTotal > totalLov) {
          const shortfall = requiredTotal - totalLov;
          push("Shortfall", formatAdaFromLovelace(shortfall.toString()));

          const toMin = minLov > totalLov ? minLov - totalLov : 0n;
          if (toMin > 0n) {
            push("Top up to min", formatAdaFromLovelace(toMin.toString()));
          }
          push("Top up to fulfill", formatAdaFromLovelace(shortfall.toString()));
        }
      }
    }

    return details;
  }, []);

  const clampPanelSize = useCallback(
    (width: number, height: number) => {
      const maxWidth =
        typeof window !== "undefined" ? Math.max(minWidth, window.innerWidth - 32) : width;
      const maxHeight =
        typeof window !== "undefined" ? Math.max(minHeight, window.innerHeight - 32) : height;
      return {
        width: Math.min(Math.max(width, minWidth), maxWidth),
        height: Math.min(Math.max(height, minHeight), maxHeight),
      };
    },
    [minHeight, minWidth],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      setPanelSize((prev) => clampPanelSize(prev.width, prev.height));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampPanelSize]);

  const nodes = useMemo<Node[]>(() => {
    return GOV_STATES.map((state, index) => ({
      id: state,
      type: "stateNode",
      position: { x: index * 150, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: state,
        active: state === activeState,
      },
    }));
  }, [activeState]);

  const refreshInfo = useCallback(async () => {
    if (typeof networkId !== "number") return;
    const hint = providerHint ? `&providerHint=${encodeURIComponent(providerHint)}` : "";
    try {
      const res = await fetch(`/api/dev/agent/info?networkId=${networkId}${hint}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (!cancelledRef.current) {
          setInfoError(data?.error || "Failed to load agent info");
        }
        return;
      }
      const data = (await res.json()) as {
        faucetAddress: string;
        agentAddress: string;
        faucetBalanceLovelace?: string;
        configDefaults?: { poolId?: string; refAddress?: string };
      };
      if (!cancelledRef.current) {
        setFaucetAddress(data.faucetAddress);
        setAgentAddress(data.agentAddress);
        setFaucetBalance(data.faucetBalanceLovelace ?? null);
        setInfoError(null);
        setConfigDefaults(data.configDefaults ?? null);
      }
    } catch (error) {
      if (!cancelledRef.current) {
        setInfoError(error instanceof Error ? error.message : "Failed to load agent info");
      }
    }
  }, [networkId]);

  const refreshRuns = useCallback(async () => {
    try {
      const res = await fetch(
        "/api/dev/agent/supervise?status=running,failed,cancelled&eventLimit=5",
      );
      if (!res.ok) return;
      const data = (await res.json()) as { runs?: RunSummary[] };
      const runs = Array.isArray(data.runs) ? data.runs : [];
      const eligible = runs.filter((entry) => entry.run?.status !== "completed");
      const matchingNetwork =
        typeof networkId === "number"
          ? eligible.filter((entry) => entry.run?.config?.networkId === networkId)
          : eligible;
      const running = matchingNetwork.find((entry) => entry.run?.status === "running");
      const candidate = matchingNetwork.find(
        (entry) =>
          entry.run?.status === "failed" ||
          entry.run?.status === "cancelled" ||
          entry.run?.status === "running",
      );
      setResumeCandidate(candidate ?? null);
      if (running) {
        const nextRunId = running.run.id;
        if (!runId || status !== "running" || runId !== nextRunId) {
          setRunId(nextRunId);
          setStatus("running");
          setRunStartedAt(running.run.startedAt ?? null);
          setRunEndedAt(running.run.endedAt ?? null);
          if (running.run.currentState) {
            setActiveState(running.run.currentState as GovState);
          }
          setEvents([]);
        }
      }
    } catch {
      setResumeCandidate(null);
    }
  }, [networkId, runId, status]);

  const refreshActiveRun = useCallback(async () => {
    if (!runId) return;
    try {
      const res = await fetch(
        `/api/dev/agent/supervise?runId=${encodeURIComponent(runId)}&eventLimit=200`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        run?: RunSummary["run"];
        events?: AgentEvent[];
      };
      if (!data.run || cancelledRef.current) return;

      setStatus(data.run.status ?? "idle");
      if (data.run.currentState) {
        setActiveState(data.run.currentState as GovState);
      }
      if (data.run.startedAt) {
        setRunStartedAt(data.run.startedAt);
      }
      setRunEndedAt(data.run.endedAt ?? null);

      if (Array.isArray(data.events)) {
        setEvents((prev) => mergeEventsById(prev, data.events));
      }
    } catch {
      // Ignore supervision refresh failures
    }
  }, [runId]);

  const refreshFaucetBalance = useCallback(async () => {
    if (typeof networkId !== "number") return;
    if (!faucetAddress) return;
    setFaucetBalanceLoading(true);
    try {
      const provider = getProvider(networkId);
      const utxos = await provider.fetchAddressUTxOs(faucetAddress);
      const total = sumLovelaceFromUtxos(utxos || []);
      if (!cancelledRef.current) {
        setFaucetBalance(total.toString());
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch faucet balance";
      if (!cancelledRef.current) {
        setFundError(message);
      }
      toast({
        title: "Balance refresh failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      if (!cancelledRef.current) setFaucetBalanceLoading(false);
    }
  }, [networkId, faucetAddress, toast]);

  const edges = useMemo<Edge[]>(() => {
    return GOV_STATES.slice(0, -1).map((state, index) => ({
      id: `${state}-${GOV_STATES[index + 1]}`,
      source: state,
      target: GOV_STATES[index + 1],
      type: "smoothstep",
      animated: state === activeState,
    }));
  }, [activeState]);

  useEffect(() => {
    void refreshInfo();
  }, [refreshInfo]);

  useEffect(() => {
    void refreshRuns();
  }, [refreshRuns]);

  useEffect(() => {
    void refreshActiveRun();
  }, [refreshActiveRun]);

  useEffect(() => {
    const interval = setInterval(() => {
      void refreshRuns();
      void refreshActiveRun();
    }, 5000);
    return () => clearInterval(interval);
  }, [refreshRuns, refreshActiveRun]);

  useEffect(() => {
    if (!runId) return;

    const source = new EventSource(`/api/dev/agent/events?runId=${runId}`);

    source.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as AgentEvent;
      setEvents((prev) => (prev.some((evt) => evt.id === parsed.id) ? prev : [...prev, parsed]));

      if (parsed.type === "state_changed" && parsed.data?.state) {
        setActiveState(parsed.data.state as GovState);
      }

      if (parsed.type === "run_started") {
        setStatus("running");
        setRunStartedAt(parsed.ts);
        setRunEndedAt(null);
      }
      if (parsed.type === "run_resumed") {
        setStatus("running");
        setRunEndedAt(null);
      }
      if (parsed.type === "run_completed") {
        setStatus("completed");
        setRunEndedAt(parsed.ts);
      }
      if (parsed.type === "run_cancelled") {
        setStatus("cancelled");
        setRunEndedAt(parsed.ts);
      }
      if (parsed.type === "error") {
        setStatus("failed");
        setRunEndedAt(parsed.ts);
      }
    };

    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, [runId]);

  useEffect(() => {
    if (status === "completed" || status === "failed" || status === "cancelled") {
      void refreshRuns();
    }
  }, [status, refreshRuns]);

  const startRun = async () => {
    if (typeof networkId !== "number") {
      setEvents((prev) => [
        ...prev,
        {
          id: `evt_${Date.now()}`,
          runId: "local",
          ts: Date.now(),
          type: "error",
          message: "Wallet network not available",
        },
      ]);
      return;
    }

    if (!configReady) {
      const missing = [
        missingPoolId ? "pool id" : null,
        missingRefAddress ? "reference address" : null,
      ]
        .filter(Boolean)
        .join(" and ");
      const message = `Missing ${missing}. Set env defaults or enter overrides.`;
      setEvents((prev) => [
        ...prev,
        {
          id: `evt_${Date.now()}`,
          runId: "local",
          ts: Date.now(),
          type: "error",
          message,
        },
      ]);
      setStatus("failed");
      toast({
        title: "Missing configuration",
        description: message,
        variant: "destructive",
      });
      return;
    }

    setEvents([]);
    setStatus("starting");
    setActiveState("Init Wallet");
    setRunStartedAt(null);
    setRunEndedAt(null);

    const res = await fetch("/api/dev/agent/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        networkId,
        ...(trimmedPoolId ? { poolId: trimmedPoolId } : {}),
        ...(trimmedRefAddress ? { refAddress: trimmedRefAddress } : {}),
        ...(providerHint ? { providerHint } : {}),
      }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      setStatus("failed");
      setEvents((prev) => [
        ...prev,
        {
          id: `evt_${Date.now()}`,
          runId: "local",
          ts: Date.now(),
          type: "error",
          message: error?.error || "Failed to start run",
        },
      ]);
      return;
    }

    const data = (await res.json()) as { runId: string };
    setRunId(data.runId);
    setStatus("running");
    setOpen(true);
  };

  const resumeRun = async () => {
    if (!resumeCandidate) return;
    setResumeLoading(true);
    setEvents([]);
    setStatus("starting");
    setActiveState("Init Wallet");
    setRunStartedAt(null);
    setRunEndedAt(null);

    const res = await fetch("/api/dev/agent/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resumeRunId: resumeCandidate.run.id }),
    });

    setResumeLoading(false);

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      setStatus("failed");
      setEvents((prev) => [
        ...prev,
        {
          id: `evt_${Date.now()}`,
          runId: "local",
          ts: Date.now(),
          type: "error",
          message: error?.error || "Failed to resume run",
        },
      ]);
      return;
    }

    const data = (await res.json()) as { runId: string };
    setRunId(data.runId);
    setStatus("running");
    setOpen(true);
  };

  const stopRun = async () => {
    if (!runId) return;
    await fetch("/api/dev/agent/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId }),
    });
    setStatus("cancelled");
    setRunEndedAt(Date.now());
  };

  const resetLog = () => {
    setEvents([]);
    setStatus("idle");
    setRunId(null);
    setActiveState("Init Wallet");
    setRunStartedAt(null);
    setRunEndedAt(null);
  };

  const resolveWalletAddress = async () => {
    if (!wallet) throw new Error("Wallet not available");
    const used = await wallet.getUsedAddresses();
    if (used?.length) return used[0];
    const unused = await wallet.getUnusedAddresses();
    if (unused?.length) return unused[0];
    throw new Error("No wallet address found");
  };

  const fundFaucet = async () => {
    if (!connected || !wallet) {
      setFundError("Wallet not connected");
      return;
    }
    if (!faucetAddress) {
      setFundError("Faucet address not available yet");
      return;
    }
    if (typeof networkId !== "number") {
      setFundError("Network not available");
      return;
    }
    const adaValue = Number(fundAmountAda);
    if (!Number.isFinite(adaValue) || adaValue <= 0) {
      setFundError("Enter a valid ADA amount");
      return;
    }

    setFunding(true);
    setFundError(null);
    setFundTxHash(null);
    try {
      const provider = getProvider(networkId);
      const evaluator =
        typeof (provider as { evaluateTx?: unknown })?.evaluateTx === "function"
          ? provider
          : undefined;
      const builder = new MeshTxBuilder({
        fetcher: provider,
        evaluator,
        submitter: provider,
        verbose: true,
      });
      builder.setNetwork(networkId === 1 ? "mainnet" : "preprod");

      const lovelace = Math.round(adaValue * 1_000_000);
      const utxos = await wallet.getUtxos();
      const changeAddress = await resolveWalletAddress();
      const unsignedTx = await builder
        .txOut(faucetAddress, [{ unit: "lovelace", quantity: lovelace.toString() }])
        .changeAddress(changeAddress)
        .selectUtxosFrom(utxos)
        .complete();

      const signedTx = await wallet.signTx(unsignedTx, true);
      const txHash = await wallet.submitTx(signedTx);
      setFundTxHash(txHash);
      setFundConfirmingTxHash(txHash);
      toast({
        title: "Faucet funding submitted",
        description: `Tx: ${txHash.substring(0, 16)}...`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Funding failed";
      setFundError(message);
      toast({
        title: "Funding failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setFunding(false);
    }
  };

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: "Copied to clipboard" });
    } catch {
      // Ignore copy errors silently
    }
  };

  const saveConfig = () => {
    if (typeof window === "undefined") return;
    const payload = {
      poolId: trimmedPoolId,
      refAddress: trimmedRefAddress,
    };
    if (!payload.poolId && !payload.refAddress) {
      window.localStorage.removeItem(STORAGE_KEY);
      setStoredConfig({ poolId: "", refAddress: "" });
      setHasStoredConfig(false);
      toast({ title: "Config cleared" });
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    setStoredConfig(payload);
    setHasStoredConfig(true);
    toast({ title: "Config saved" });
  };

  const buildLogText = () => {
    if (events.length === 0) return "";
    return events
      .map((evt) => {
        const time = formatTime(evt.ts);
        const message = evt.message ? ` ${evt.message}` : "";
        const data = evt.data ? ` ${JSON.stringify(evt.data)}` : "";
        return `[${time}] ${evt.type}${message}${data}`;
      })
      .join("\n");
  };

  const copyLogs = async () => {
    const text = buildLogText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Logs copied" });
    } catch {
      toast({ title: "Failed to copy logs", variant: "destructive" });
    }
  };

  const downloadLogs = () => {
    const text = buildLogText();
    if (!text) return;
    const blob = new Blob([text], { type: "text/plain" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `test-agent-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] text-sm"
      style={{ width: panelSize.width, maxWidth: "90vw" }}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <div
          className="relative flex flex-col rounded-lg border bg-background/95 shadow-lg backdrop-blur"
          style={{
            height: open ? panelSize.height : "auto",
            maxHeight: open ? "90vh" : undefined,
          }}
        >
          <div className="flex items-center justify-between pr-4 pl-12 py-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Test Agent
              </div>
              <div className="text-sm font-semibold">Crowdfund Smoke Runner</div>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                {open ? "Hide" : "Show"}
              </Button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="flex-1 min-h-0">
            <Tabs defaultValue="setup" className="flex h-full flex-col">
              <div className="px-4">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="setup">Setup</TabsTrigger>
                  <TabsTrigger value="run">Run</TabsTrigger>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="setup" className="flex-1 overflow-y-auto px-4 pb-4 pt-3">
                <div className="space-y-4">
                  <details className="rounded-md border bg-muted/10 p-2 text-xs" open>
                    <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Configuration
                    </summary>
                    <div className="mt-3 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="secondary" onClick={saveConfig} disabled={!configDirty}>
                          Save config
                        </Button>
                        {hasStoredConfig && !configDirty && (
                          <span className="text-[11px] text-muted-foreground">
                            Saved locally
                          </span>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Pool ID</Label>
                        <Input
                          value={poolId}
                          onChange={(event) => setPoolId(event.target.value)}
                          placeholder="pool..."
                          className="h-8 text-xs"
                        />
                        <div className="text-[11px] text-muted-foreground">
                          Used for governance delegation in the test run.
                        </div>
                        {configDefaults?.poolId && !trimmedPoolId && (
                          <div className="text-[11px] text-muted-foreground">
                            Env default: {configDefaults.poolId}
                          </div>
                        )}
                        {poolIdWarning && (
                          <div className="text-[11px] text-amber-600">
                            Tip: pool ids usually start with "pool".
                          </div>
                        )}
                        {missingPoolId && (
                          <div className="text-[11px] text-red-500">
                            Required: enter Pool ID or set TEST_AGENT_POOL_ID.
                          </div>
                        )}
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Reference Address</Label>
                        <Input
                          value={refAddress}
                          onChange={(event) => setRefAddress(event.target.value)}
                          placeholder="addr..."
                          className="h-8 text-xs"
                        />
                        <div className="text-[11px] text-muted-foreground">
                          Used as the reference address for the contract.
                        </div>
                        {configDefaults?.refAddress && !trimmedRefAddress && (
                          <div className="text-[11px] text-muted-foreground">
                            Env default: {configDefaults.refAddress}
                          </div>
                        )}
                        {refAddressWarning && (
                          <div className="text-[11px] text-amber-600">
                            Tip: addresses usually start with "addr".
                          </div>
                        )}
                        {missingRefAddress && (
                          <div className="text-[11px] text-red-500">
                            Required: enter Reference Address or set NEXT_PUBLIC_REF_ADDR.
                          </div>
                        )}
                      </div>

                      <div className="text-[11px] text-muted-foreground">
                        Overrides apply only to this run. Env defaults are unchanged.
                        Saved config is stored locally in this browser.
                      </div>
                    </div>
                  </details>

                  <details className="rounded-md border bg-muted/10 p-2 text-xs" open>
                    <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Faucet Funding
                    </summary>
                    <div className="mt-3 space-y-2">
                      <div className="text-muted-foreground">
                        Fund the faucet address once; it will fund the agent wallet.
                      </div>
                      {infoError ? (
                        <div className="text-red-500">{infoError}</div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">Faucet: {faucetAddress ?? "-"}</span>
                            {faucetAddress && (
                              <Button size="sm" variant="ghost" onClick={() => copyText(faucetAddress)}>
                                Copy
                              </Button>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">
                              Faucet balance: {formatAdaFromLovelace(faucetBalance)}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void refreshFaucetBalance()}
                              disabled={faucetBalanceLoading}
                            >
                              {faucetBalanceLoading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">Agent: {agentAddress ?? "-"}</span>
                            {agentAddress && (
                              <Button size="sm" variant="ghost" onClick={() => copyText(agentAddress)}>
                                Copy
                              </Button>
                            )}
                          </div>
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                              <Input
                                className="h-8 text-xs"
                                type="number"
                                min="0"
                                step="0.1"
                                value={fundAmountAda}
                                onChange={(e) => setFundAmountAda(e.target.value)}
                                placeholder="ADA amount"
                              />
                              <Button size="sm" onClick={fundFaucet} disabled={funding}>
                                {funding ? "Funding..." : "Fund Faucet"}
                              </Button>
                            </div>
                            {fundTxHash && (
                              <div className="flex items-center justify-between gap-2 text-emerald-500">
                                <span>Funded: {fundTxHash.substring(0, 16)}...</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => copyText(fundTxHash)}
                                >
                                  Copy Tx
                                </Button>
                              </div>
                            )}
                            {fundConfirmingTxHash && typeof networkId === "number" && (
                              <div className="rounded-md border border-amber-200/60 bg-amber-50/50 p-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
                                <TxConfirmationProgress
                                  txHash={fundConfirmingTxHash}
                                  networkId={networkId}
                                  onConfirmed={() => {
                                    setFundConfirmingTxHash(null);
                                    void refreshFaucetBalance();
                                    window.setTimeout(() => {
                                      if (!cancelledRef.current) {
                                        void refreshFaucetBalance();
                                      }
                                    }, 4000);
                                    toast({
                                      title: "Faucet funding confirmed",
                                      description: `Tx: ${fundConfirmingTxHash.substring(0, 16)}...`,
                                    });
                                  }}
                                  onError={(error) => {
                                    const message =
                                      error instanceof Error
                                        ? error.message
                                        : "Failed to confirm transaction";
                                    setFundConfirmingTxHash(null);
                                    setFundError(message);
                                    toast({
                                      title: "Confirmation failed",
                                      description: message,
                                      variant: "destructive",
                                    });
                                  }}
                                />
                              </div>
                            )}
                            {fundError && <div className="text-red-500">{fundError}</div>}
                          </div>
                        </>
                      )}
                    </div>
                  </details>
                </div>
              </TabsContent>

              <TabsContent value="run" className="flex-1 overflow-y-auto px-4 pb-4 pt-3">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      onClick={startRun}
                      disabled={!configReady || status === "running" || status === "starting"}
                    >
                      Start Run
                    </Button>
                    {resumeCandidate && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={resumeRun}
                        disabled={
                          resumeLoading ||
                          status === "running" ||
                          status === "starting" ||
                          !canResumeCandidate
                        }
                      >
                        {resumeLoading ? "Resuming..." : "Resume Last"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={stopRun}
                      disabled={!runId || status !== "running"}
                    >
                      Stop
                    </Button>
                    <Button size="sm" variant="ghost" onClick={resetLog}>
                      Reset Log
                    </Button>
                    {!configReady && (
                      <div className="text-[11px] text-red-500">
                        Missing pool id or reference address.
                      </div>
                    )}
                    {resumeCandidate && (
                      <div className="text-[11px] text-muted-foreground">
                        Last run: {formatTime(resumeCandidate.run.startedAt)} (
                        {resumeCandidate.run.status})
                      </div>
                    )}
                  </div>

                  <div className="rounded-md border bg-muted/10 p-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          getStatusClasses(status),
                        )}
                      >
                        {status}
                      </span>
                      <span className="text-muted-foreground">
                        State: <span className="font-medium text-foreground">{activeState}</span>
                      </span>
                    </div>
                    <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <div>
                        Network: <span className="font-medium text-foreground">{String(networkId ?? "?")}</span>
                      </div>
                      <div>
                        Run ID: <span className="font-medium text-foreground">{runId ?? "-"}</span>
                      </div>
                      <div>
                        Duration: <span className="font-medium text-foreground">{formatDuration(durationMs)}</span>
                      </div>
                      <div>
                        Last event: <span className="font-medium text-foreground">{formatTime(lastEvent?.ts)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="h-[120px] rounded-md border bg-muted/40">
                    <ReactFlow
                      nodes={nodes}
                      edges={edges}
                      nodeTypes={NODE_TYPES}
                      fitView
                      fitViewOptions={{ padding: 0.2 }}
                      nodesDraggable={false}
                      nodesConnectable={false}
                      proOptions={{ hideAttribution: true }}
                      nodeOrigin={[0.5, 0.5]}
                    >
                      <Background gap={24} size={1} />
                      <Controls />
                    </ReactFlow>
                  </div>

                  <details className="rounded-md border bg-muted/10 p-2 text-xs" open>
                    <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Event Log
                    </summary>
                    <div className="mt-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="secondary" onClick={copyLogs} disabled={!events.length}>
                          Copy logs
                        </Button>
                        <Button size="sm" variant="secondary" onClick={downloadLogs} disabled={!events.length}>
                          Download
                        </Button>
                        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <input
                            type="checkbox"
                            className="h-3 w-3 rounded border border-muted-foreground/60"
                            checked={showEventData}
                            onChange={(event) => setShowEventData(event.target.checked)}
                          />
                          Show raw event data
                        </label>
                      </div>

                      <div className="max-h-48 overflow-auto rounded-md border bg-muted/20 p-2 text-xs">
                        {events.length === 0 ? (
                          <div className="text-muted-foreground">No events yet.</div>
                        ) : (
                          events.map((evt) => {
                            const details = getEventDetails(evt);
                            return (
                              <div key={evt.id} className="mb-2 rounded-md border border-border/60 bg-background/60 p-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono text-[10px] text-muted-foreground">
                                    {formatTime(evt.ts)}
                                  </span>
                                  <span
                                    className={cn(
                                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                      getEventClasses(evt.type),
                                    )}
                                  >
                                    {evt.type.replace(/_/g, " ")}
                                  </span>
                                  {evt.message && <span className="text-foreground">{evt.message}</span>}
                                </div>
                                {details.length > 0 && (
                                  <div className="mt-2 grid gap-1 text-[11px] text-muted-foreground">
                                    {details.map((detail, index) => (
                                      <div key={`${detail.label}-${index}`} className="flex flex-wrap gap-2">
                                        <span className="uppercase text-[10px] text-muted-foreground/70">
                                          {detail.label}:
                                        </span>
                                        <span className="text-foreground">{detail.value}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {showEventData && evt.data && (
                                  <pre className="mt-2 whitespace-pre-wrap break-all text-[11px] text-muted-foreground">
                                    {JSON.stringify(evt.data, null, 2)}
                                  </pre>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </details>
                </div>
              </TabsContent>

              <TabsContent value="overview" className="flex-1 overflow-y-auto px-4 pb-4 pt-3">
                <div className="space-y-4">
                  <div className="rounded-md border bg-muted/10 p-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          getStatusClasses(status),
                        )}
                      >
                        {status}
                      </span>
                      <span className="text-muted-foreground">
                        State: <span className="font-medium text-foreground">{activeState}</span>
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <div>
                        Network: <span className="font-medium text-foreground">{String(networkId ?? "?")}</span>
                      </div>
                      <div>
                        Run ID: <span className="font-medium text-foreground">{runId ?? "-"}</span>
                      </div>
                      <div>
                        Started: <span className="font-medium text-foreground">{formatTime(runStartedAt)}</span>
                      </div>
                      <div>
                        Ended: <span className="font-medium text-foreground">{formatTime(runEndedAt)}</span>
                      </div>
                      <div>
                        Duration: <span className="font-medium text-foreground">{formatDuration(durationMs)}</span>
                      </div>
                      <div>
                        Last event: <span className="font-medium text-foreground">{formatTime(lastEvent?.ts)}</span>
                      </div>
                    </div>
                  </div>

                  {lastErrorEvent && status === "failed" && (
                    <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-600">
                      <div className="text-xs font-semibold uppercase tracking-wide text-red-600">
                        Last error
                      </div>
                      <div className="mt-2 text-sm text-foreground">
                        {lastErrorEvent.message ?? "Run failed"}
                      </div>
                      {getEventDetails(lastErrorEvent).length > 0 && (
                        <div className="mt-2 grid gap-1 text-[11px] text-red-600">
                          {getEventDetails(lastErrorEvent).map((detail, index) => (
                            <div key={`${detail.label}-${index}`} className="flex flex-wrap gap-2">
                              <span className="uppercase text-[10px] text-red-500/70">
                                {detail.label}:
                              </span>
                              <span>{detail.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="rounded-md border bg-muted/10 p-3 text-xs">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Job breakdown
                    </div>
                    <div className="mt-3 space-y-3">
                      {jobSteps.map((step) => {
                        const duration =
                          step.startedAt
                            ? formatDuration(
                                (step.endedAt ?? (step.status === "running" ? Date.now() : step.startedAt)) -
                                  step.startedAt,
                              )
                            : null;
                        const lastLog = step.logs.length ? step.logs[step.logs.length - 1] : null;
                        const errorDetails = step.error ? getEventDetails(step.error) : [];
                        const logDetails = lastLog ? getEventDetails(lastLog) : [];
                        return (
                          <div key={step.key} className="rounded-md border border-border/60 bg-background/60 p-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                  getStepStatusClasses(step.status),
                                )}
                              >
                                {step.status}
                              </span>
                              <span className="text-foreground">{step.label}</span>
                              {duration && (
                                <span className="text-[10px] text-muted-foreground">
                                  {duration}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-[11px] text-muted-foreground">{step.help}</div>
                            <div className="mt-2 grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
                              <div>
                                Started: <span className="text-foreground">{formatTime(step.startedAt)}</span>
                              </div>
                              <div>
                                Ended: <span className="text-foreground">{formatTime(step.endedAt)}</span>
                              </div>
                            </div>
                            {step.error && (
                              <div className="mt-2 rounded-md border border-red-500/20 bg-red-500/5 p-2 text-[11px] text-red-600">
                                <div className="font-semibold">Error: {step.error.message ?? "Failed"}</div>
                                {errorDetails.length > 0 && (
                                  <div className="mt-1 grid gap-1 text-[11px] text-red-600">
                                    {errorDetails.map((detail, index) => (
                                      <div key={`${detail.label}-${index}`} className="flex flex-wrap gap-2">
                                        <span className="uppercase text-[10px] text-red-500/70">
                                          {detail.label}:
                                        </span>
                                        <span>{detail.value}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                            {!step.error && lastLog?.message && (
                              <div className="mt-2 rounded-md border border-border/60 bg-muted/20 p-2 text-[11px] text-muted-foreground">
                                <div className="font-semibold text-foreground">Latest log: {lastLog.message}</div>
                                {logDetails.length > 0 && (
                                  <div className="mt-1 grid gap-1 text-[11px] text-muted-foreground">
                                    {logDetails.map((detail, index) => (
                                      <div key={`${detail.label}-${index}`} className="flex flex-wrap gap-2">
                                        <span className="uppercase text-[10px] text-muted-foreground/70">
                                          {detail.label}:
                                        </span>
                                        <span className="text-foreground">{detail.value}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CollapsibleContent>
          {isResizing && (
            <div className="pointer-events-none absolute right-10 top-3 rounded-md border border-border/60 bg-background/80 px-2 py-1 text-[10px] text-muted-foreground shadow-sm">
              {Math.round(panelSize.width)}×{Math.round(panelSize.height)}
            </div>
          )}
          <div
            className="absolute left-2 top-2 flex h-7 w-7 cursor-nwse-resize items-center justify-center rounded-md border border-muted-foreground/40 bg-muted/40 text-muted-foreground/80 hover:bg-muted/60"
            onMouseDown={(event) => {
              event.preventDefault();
              resizingRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                startWidth: panelSize.width,
                startHeight: panelSize.height,
              };
              setIsResizing(true);
              const onMove = (moveEvent: MouseEvent) => {
                if (!resizingRef.current) return;
                const deltaX = moveEvent.clientX - resizingRef.current.startX;
                const deltaY = moveEvent.clientY - resizingRef.current.startY;
                const { width, height } = clampPanelSize(
                  resizingRef.current.startWidth - deltaX,
                  resizingRef.current.startHeight - deltaY,
                );
                setPanelSize({ width, height });
              };
              const onUp = () => {
                resizingRef.current = null;
                setIsResizing(false);
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
              };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            }}
            title="Drag to resize"
          >
            <Grip className="h-4 w-4" />
          </div>
        </div>
      </Collapsible>
    </div>
  );
}
