export type CIWalletType = "legacy" | "hierarchical" | "sdk";

export type CIWalletContext = {
  type: CIWalletType;
  walletId: string;
  walletAddress: string;
  transactionId?: string;
  signerAddresses: string[];
};

export type CIBotContext = {
  id: string;
  paymentAddress: string;
  botKeyId: string;
  botId?: string;
};

export type CIBootstrapContext = {
  schemaVersion: 2;
  createdAt: string;
  apiBaseUrl: string;
  networkId: 0 | 1;
  walletTypes: CIWalletType[];
  wallets: CIWalletContext[];
  bots: CIBotContext[];
  defaultBotId?: string;
  walletId?: string;
  walletAddress?: string;
  signerAddresses: string[];
  transactionId?: string;
};

export type StepSeverity = "critical" | "non-critical";

export type StepRunResult = {
  message: string;
  artifacts?: Record<string, unknown>;
};

export type RouteStep = {
  id: string;
  description: string;
  severity?: StepSeverity;
  execute: (ctx: CIBootstrapContext) => Promise<StepRunResult>;
};

export type Scenario = {
  id: string;
  description: string;
  steps: RouteStep[];
};

export type StepReport = {
  id: string;
  description: string;
  status: "passed" | "failed" | "skipped";
  severity: StepSeverity;
  message: string;
  durationMs: number;
  artifacts?: Record<string, unknown>;
  error?: string;
};

export type ScenarioReport = {
  id: string;
  description: string;
  status: "passed" | "failed";
  durationMs: number;
  steps: StepReport[];
};

export type RunReport = {
  createdAt: string;
  scenarioIds: string[];
  status: "passed" | "failed";
  durationMs: number;
  contextSummary: {
    apiBaseUrl: string;
    networkId: 0 | 1;
    walletCount: number;
    walletTypes: CIWalletType[];
  };
  scenarios: ScenarioReport[];
};
