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

export type RunStatus = "running" | "completed" | "failed" | "cancelled" | "waiting";

export type AgentEventType =
  | "run_started"
  | "run_resumed"
  | "run_completed"
  | "run_cancelled"
  | "run_waiting"
  | "step_started"
  | "step_completed"
  | "state_changed"
  | "log"
  | "error";

export type RunProgress = {
  walletAddress?: string;
  faucetTxHash?: string;
  faucetAmountLovelace?: number;
  faucetPendingAmountLovelace?: number;
  collateralTxHash?: string;
  stakeRefScriptTxHash?: string;
  stakeRefScript?: { txHash: string; outputIndex: number };
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
  treasuryFinalContributeTxHash?: string;
  treasuryInitialContributeAmount?: number;
  treasuryWithdrawAmount?: number;
  treasuryFinalContributeAmount?: number;
  govActionTxHash?: string;
  govActionId?: { txHash: string; index: number };
  govActionType?: "InfoAction" | "TreasuryWithdrawalsAction";
  treasuryWithdrawals?: Record<string, string>;
};

export type RunConfig = {
  networkId: number;
  amountLovelace?: number;
  fundraiseTargetLovelace?: number;
  poolId?: string;
  refAddress?: string;
  providerHint?: "blockfrost" | "koios";
  govActionType?: "InfoAction" | "TreasuryWithdrawalsAction";
  treasuryWithdrawals?: Record<string, string>;
  stopAfterPropose?: boolean;
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
