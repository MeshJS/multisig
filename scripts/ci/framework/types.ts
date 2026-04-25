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
  schemaVersion: 3;
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
  /** Per-signer stake (reward) addresses aligned with signerAddresses. */
  signerStakeAddresses: string[];
  /** Multisig reward address for the SDK wallet (from MultisigWallet.getStakeAddress); present when an SDK wallet was bootstrapped. */
  sdkStakeAddress?: string;
  /** Optional preprod stake pool id (hex) for future delegate scenarios. */
  stakePoolIdHex?: string;
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

export type CIWalletBalanceEntry = {
  walletType: CIWalletType;
  walletId: string;
  walletAddress: string;
  utxoCount: number;
  lovelace: string;
  assets: Record<string, string>;
  capturedAt: string;
  networkId: 0 | 1;
};

export type CIWalletBalanceSummary = {
  capturedAt: string;
  networkId: 0 | 1;
  byWalletType: Partial<Record<CIWalletType, CIWalletBalanceEntry>>;
  byWalletId: Record<string, CIWalletBalanceEntry>;
  error?: string;
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
  walletBalanceSummary: CIWalletBalanceSummary;
  scenarios: ScenarioReport[];
};
