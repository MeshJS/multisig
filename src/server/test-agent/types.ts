export type GovState =
  | "Init Wallet"
  | "Faucet Funded"
  | "Collateral Ready"
  | "Crowdfund"
  | "Contributed"
  | "Withdrawn"
  | "RegisteredCerts"
  | "Proposed"
  | "Voted"
  | "Refundable";

export type RunStatus = "running" | "completed" | "failed" | "cancelled";

export type AgentEventType =
  | "run_started"
  | "run_resumed"
  | "run_completed"
  | "run_cancelled"
  | "step_started"
  | "step_completed"
  | "state_changed"
  | "log"
  | "error";

export type RunProgress = {
  walletAddress?: string;
  faucetTxHash?: string;
  faucetAmountLovelace?: number;
  collateralTxHash?: string;
  crowdfundSetupTxHash?: string;
  crowdfundId?: string;
  crowdfundAddress?: string;
  paramUtxo?: { txHash: string; outputIndex: number };
  authTokenId?: string;
  shareToken?: string;
  stakeScriptHash?: string;
  spendRefScript?: { txHash: string; outputIndex: number };
  crowdfundDatum?: Record<string, unknown>;
  govExtension?: Record<string, unknown>;
  contributeTxHash?: string;
  withdrawTxHash?: string;
};

export type RunConfig = {
  networkId: number;
  amountLovelace?: number;
  poolId?: string;
  refAddress?: string;
  providerHint?: "blockfrost" | "koios";
};

export type AgentEvent = {
  id: string;
  runId: string;
  ts: number;
  type: AgentEventType;
  message?: string;
  data?: Record<string, unknown>;
};

export type RunRecord = {
  id: string;
  status: RunStatus;
  config: RunConfig;
  startedAt: number;
  endedAt?: number;
  currentState?: GovState;
  error?: string;
  progress?: RunProgress;
  completedSteps?: string[];
};
