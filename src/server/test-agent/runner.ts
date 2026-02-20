import { MeshCrowdfundContract } from "@/components/crowdfund/offchain";
import type { CrowdfundDatumTS } from "@/components/crowdfund/crowdfund";
import { env } from "@/env";
import { getTestAgentProvider } from "@/server/test-agent/provider";
import { db } from "@/server/db";
import {
  MeshWallet,
  deserializeAddress,
  serializeRewardAddress,
} from "@meshsdk/core";
import { scriptHash } from "@meshsdk/common";
import type { GovernanceAction } from "@meshsdk/common";
import { MeshTxBuilder, TxParser } from "@meshsdk/transaction";

import type { AgentEvent, GovState, RunConfig, RunRecord, RunProgress } from "./types";
import { addEvent, createRun, getRun, setRunStatus, updateRun } from "./state";
import { sendFaucetFunds } from "./faucet";
import { loadOrCreateMnemonics } from "./keys";

const DEFAULT_FAUCET_AMOUNT = 200_000_000; // 200 ADA
const TREASURY_FUNDRAISE_TARGET = 100_000_000_000; // 100k ADA
const CONTRIBUTION_AMOUNT = 5_000_000; // 5 ADA
const WITHDRAW_AMOUNT = 2_000_000; // 2 ADA
const REF_SPEND_OUTPUT_LOVELACE = 80_000_000; // 80 ADA
const REF_STAKE_OUTPUT_LOVELACE = 70_000_000; // 70 ADA
const COLLATERAL_OUTPUT_LOVELACE = 5_000_000; // 5 ADA
const TREASURY_FEE_BUFFER = 10_000_000; // 10 ADA

const STEP_KEYS = {
  initWallet: "Initialize wallet",
  faucet: "Request faucet funds",
  collateral: "Setup collateral",
  setupCrowdfund: "Setup crowdfund",
  stakeRefScript: "Setup stake ref script",
  registerCerts: "Register certs",
  vote: "Vote on gov action",
  deregister: "Deregister certs",
  contribute: "Contribute to crowdfund",
  withdraw: "Withdraw from crowdfund",
} as const;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const buildMnemonicWords = (mnemonic: string) =>
  mnemonic
    .split(" ")
    .map((word) => word.trim())
    .filter(Boolean);

const getProgress = (runId: string): RunProgress => {
  return getRun(runId)?.progress ?? {};
};

const updateProgress = (runId: string, patch: Partial<RunProgress>) => {
  const run = getRun(runId);
  if (!run) return;
  const progress = { ...(run.progress ?? {}), ...patch };
  updateRun(runId, { progress });
};

const isStepCompleted = (runId: string, key: string) => {
  const run = getRun(runId);
  return run?.completedSteps?.includes(key) ?? false;
};

const markStepCompleted = (runId: string, key: string) => {
  const run = getRun(runId);
  if (!run) return;
  const completed = new Set(run.completedSteps ?? []);
  completed.add(key);
  updateRun(runId, { completedSteps: Array.from(completed) });
};

const parseJson = <T>(raw?: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const resolveFullUtxo = async (
  provider: ReturnType<typeof getTestAgentProvider>,
  ref: { txHash: string; outputIndex: number },
) => {
  const utxos = await provider.fetchUTxOs(ref.txHash);
  return utxos.find((utxo) => utxo.input.outputIndex === ref.outputIndex);
};

const emit = (runId: string, partial: Omit<AgentEvent, "id" | "runId" | "ts">) => {
  const event: AgentEvent = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    runId,
    ts: Date.now(),
    ...partial,
  };
  addEvent(runId, event);
};

const safeJson = (value: unknown) => {
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, val) => (typeof val === "bigint" ? val.toString() : val)),
    );
  } catch {
    return undefined;
  }
};

const serializeError = (error: unknown) => {
  let message = "Unknown error";
  let name: string | undefined;
  let stack: string | undefined;
  let details: unknown;
  let cause: unknown;
  let raw: unknown;

  if (error instanceof Error) {
    message = error.message || error.name || message;
    name = error.name;
    stack = error.stack;
    cause = (error as { cause?: unknown }).cause;
    details = (error as { details?: unknown }).details;
  } else if (typeof error === "string") {
    message = error;
  } else if (error && typeof error === "object") {
    const maybe = error as { message?: unknown; name?: unknown; stack?: unknown; details?: unknown; cause?: unknown };
    if (typeof maybe.message === "string" && maybe.message.trim()) {
      message = maybe.message;
    }
    if (typeof maybe.name === "string") name = maybe.name;
    if (typeof maybe.stack === "string") stack = maybe.stack;
    if ("details" in maybe) details = maybe.details;
    if ("cause" in maybe) cause = maybe.cause;
    raw = safeJson(error);
  }

  const data: Record<string, unknown> = {};
  if (name) data.name = name;
  if (stack) data.stack = stack;
  if (details !== undefined) data.details = safeJson(details) ?? details;
  if (cause !== undefined) data.cause = safeJson(cause) ?? cause;
  if (raw !== undefined) data.raw = raw;

  return { message, data: Object.keys(data).length > 0 ? data : undefined };
};

const ensureNotCancelled = (runId: string) => {
  const run = getRun(runId);
  if (!run) {
    throw new Error("Run not found");
  }
  if (run.status === "cancelled") {
    throw new Error("Run cancelled");
  }
};

type ConfirmationOptions =
  | number
  | {
      maxWaitMs?: number;
      addresses?: string[];
    };

const waitForConfirmation = async (
  txHash: string,
  provider: any,
  options?: ConfirmationOptions,
) => {
  const maxWaitMs =
    typeof options === "number" ? options : options?.maxWaitMs;
  const addresses =
    typeof options === "object" && options ? options.addresses : undefined;
  const providerName = provider?.constructor?.name?.toLowerCase?.() ?? "";
  const isKoios = providerName.includes("koios");
  const timeoutMs =
    typeof maxWaitMs === "number" && maxWaitMs > 0
      ? maxWaitMs
      : isKoios
        ? 600_000
        : 120_000;
  const start = Date.now();
  const normalizedAddresses = (addresses ?? []).filter(
    (address): address is string => Boolean(address && address.trim()),
  );

  while (Date.now() - start < timeoutMs) {
    try {
      const info = await provider.fetchTxInfo(txHash);
      if (info) return;
    } catch {
      // Ignore and retry
    }

    if (normalizedAddresses.length > 0) {
      for (const address of normalizedAddresses) {
        try {
          const utxos = await provider.fetchAddressUTxOs(address);
          if (
            Array.isArray(utxos) &&
            utxos.some((utxo: any) => utxo?.input?.txHash === txHash)
          ) {
            return;
          }
        } catch {
          // Ignore and retry
        }
      }
    }
    await wait(2_000);
  }
  throw new Error(
    `Transaction ${txHash} not confirmed within ${timeoutMs}ms`,
  );
};

const isTxConfirmed = async (
  txHash: string,
  provider: any,
  addresses?: string[],
) => {
  try {
    const info = await provider.fetchTxInfo(txHash);
    if (info) return true;
  } catch {
    // ignore
  }

  const normalized = (addresses ?? []).filter(
    (address): address is string => Boolean(address && address.trim()),
  );
  for (const address of normalized) {
    try {
      const utxos = await provider.fetchAddressUTxOs(address);
      if (
        Array.isArray(utxos) &&
        utxos.some((utxo: any) => utxo?.input?.txHash === txHash)
      ) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
};

const resolveWalletAddress = async (wallet: any): Promise<string> => {
  if (typeof wallet.getUsedAddresses === "function") {
    const used = await wallet.getUsedAddresses();
    if (used && used.length > 0) return used[0];
  }
  if (typeof wallet.getUnusedAddresses === "function") {
    const unused = await wallet.getUnusedAddresses();
    if (unused && unused.length > 0) return unused[0];
  }
  if (typeof wallet.getChangeAddress === "function") {
    return wallet.getChangeAddress();
  }
  throw new Error("Unable to resolve wallet address");
};

const resolveRewardAddress = (address: string, networkId: number): string => {
  const decoded = deserializeAddress(address);
  const stakeHash =
    decoded.stakeCredentialHash || decoded.stakeScriptCredentialHash;
  const isScriptStake = Boolean(decoded.stakeScriptCredentialHash);
  if (!stakeHash) {
    throw new Error("Unable to resolve stake credential from wallet address");
  }
  const reward = serializeRewardAddress(stakeHash, isScriptStake, networkId as 0 | 1);
  if (!reward) {
    throw new Error("Unable to build reward address from stake credential");
  }
  return reward;
};

const isRewardAddress = (address: string) =>
  address.startsWith("stake1") || address.startsWith("stake_test1");

const normalizeTreasuryWithdrawals = (
  withdrawals: Record<string, string | number>,
  networkId: number,
): Record<string, string> => {
  const entries = Object.entries(withdrawals);
  if (entries.length === 0) {
    return {};
  }

  const normalized = entries.map(([address, amount], index) => {
    const trimmedAddress = String(address).trim();
    if (!isRewardAddress(trimmedAddress)) {
      throw new Error(
        `Treasury withdrawals require reward addresses (stake1.../stake_test1...). ` +
          `Got: ${trimmedAddress}`,
      );
    }
    if (networkId === 0 && !trimmedAddress.startsWith("stake_test1")) {
      throw new Error(
        `Treasury withdrawal address must be testnet reward address (stake_test1...). ` +
          `Got: ${trimmedAddress}`,
      );
    }
    if (networkId === 1 && !trimmedAddress.startsWith("stake1")) {
      throw new Error(
        `Treasury withdrawal address must be mainnet reward address (stake1...). ` +
          `Got: ${trimmedAddress}`,
      );
    }
    const normalizedAmount =
      typeof amount === "string" ? amount.trim() : String(amount);
    if (!normalizedAmount || !/^\d+$/.test(normalizedAmount)) {
      throw new Error(
        `Treasury withdrawal amount at index ${index} is invalid: "${amount}". ` +
          `Expected a positive lovelace string.`,
      );
    }
    if (normalizedAmount === "0") {
      throw new Error(
        `Treasury withdrawal amount at index ${index} is zero.`,
      );
    }
    return [trimmedAddress, normalizedAmount] as const;
  });

  normalized.sort(([a], [b]) => a.localeCompare(b));

  return normalized.reduce(
    (acc, [address, amount]) => {
      acc[address] = amount;
      return acc;
    },
    {} as Record<string, string>,
  );
};

type RawGovExtension = {
  delegate_pool_id?: string;
  gov_action_period?: number | string;
  stake_register_deposit?: number | string;
  drep_register_deposit?: number | string;
  gov_deposit?: number | string;
  gov_action?: unknown;
  govActionMetadataUrl?: string;
  govActionMetadataHash?: string;
  drepMetadataUrl?: string;
  drepMetadataHash?: string;
};

const toNumber = (value: number | string | undefined, fallback: number) =>
  value != null ? Number(value) : fallback;

const isHexString = (value: string) => /^[0-9a-fA-F]+$/.test(value);

const normalizePolicyHash = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!isHexString(trimmed)) {
    throw new Error(
      `Treasury withdrawal guardrails policyHash must be hex. Got: ${value}`,
    );
  }
  if (trimmed.length === 64) {
    const guardrails = env.NEXT_PUBLIC_GUARDRAILS_POLICY_HASH;
    if (
      typeof guardrails === "string" &&
      guardrails.trim().length === 56 &&
      isHexString(guardrails.trim())
    ) {
      return scriptHash(guardrails.trim());
    }
    throw new Error(
      `Legacy guardrails policyHash detected (${trimmed}). Provide a 56-hex NEXT_PUBLIC_GUARDRAILS_POLICY_HASH to proceed.`,
    );
  }
  return scriptHash(trimmed);
};

const normalizeGovAction = (
  raw: unknown,
  options?: { preserveLegacyPolicyHash?: boolean },
): GovernanceAction | undefined => {
  if (!raw) return undefined;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return normalizeGovAction(parsed, options);
    } catch {
      return undefined;
    }
  }
  if (typeof raw !== "object") return undefined;

  const candidate = raw as { kind?: string; type?: string; action?: any; metadata?: any };
  if (candidate.kind) {
    return candidate as GovernanceAction;
  }

  const type = candidate.type || "info";
  const typeToKind: Record<string, GovernanceAction["kind"]> = {
    motion_no_confidence: "NoConfidenceAction",
    update_committee: "UpdateCommitteeAction",
    new_constitution: "NewConstitutionAction",
    hard_fork: "HardForkInitiationAction",
    protocol_parameter_changes: "ParameterChangeAction",
    treasury_withdrawals: "TreasuryWithdrawalsAction",
    info: "InfoAction",
  };
  const kind = typeToKind[type] || "InfoAction";

  if (kind === "TreasuryWithdrawalsAction") {
    const metadataBeneficiaries = Array.isArray(candidate.metadata?.beneficiaries)
      ? candidate.metadata.beneficiaries
      : [];
    const beneficiaryWithdrawals = metadataBeneficiaries.reduce(
      (acc: Record<string, string>, beneficiary: any) => {
        if (beneficiary?.address && beneficiary?.amount) {
          acc[beneficiary.address] = beneficiary.amount;
        }
        return acc;
      },
      {},
    );
    const withdrawals: Record<string, string> =
      Object.keys(beneficiaryWithdrawals).length > 0
        ? beneficiaryWithdrawals
        : candidate.metadata?.withdrawals || candidate.action?.withdrawals || {};
    const policyHash = candidate.metadata?.policyHash || candidate.action?.policyHash;
    let normalizedPolicyHash = policyHash;
    if (typeof policyHash === "string") {
      const trimmed = policyHash.trim();
      if (!isHexString(trimmed)) {
        throw new Error(
          `Treasury withdrawal guardrails policyHash must be hex. Got: ${policyHash}`,
        );
      }
      if (trimmed.length === 64 && options?.preserveLegacyPolicyHash) {
        normalizedPolicyHash = trimmed;
      } else {
        normalizedPolicyHash = normalizePolicyHash(trimmed);
      }
    }
    return {
      kind: "TreasuryWithdrawalsAction",
      action: {
        withdrawals,
        ...(normalizedPolicyHash ? { policyHash: normalizedPolicyHash } : {}),
      },
    };
  }

  return {
    kind,
    action: {},
  } as GovernanceAction;
};

const buildWalletAdapter = async (wallet: any) => {
  return {
    getUtxos: () => wallet.getUtxos(),
    getCollateral: () => wallet.getCollateral(),
    getUsedAddresses: async () => {
      if (typeof wallet.getUsedAddresses === "function") {
        return wallet.getUsedAddresses();
      }
      const address = await resolveWalletAddress(wallet);
      return [address];
    },
    getUnusedAddresses: async () => {
      if (typeof wallet.getUnusedAddresses === "function") {
        return wallet.getUnusedAddresses();
      }
      return [];
    },
    signTx: (tx: string, partial?: boolean) => wallet.signTx(tx, partial ?? true),
    submitTx: (tx: string) => wallet.submitTx(tx),
  } as any;
};

const updateState = (runId: string, state: GovState) => {
  const run = getRun(runId);
  if (run?.currentState === state) {
    updateRun(runId, { currentState: state });
    return;
  }
  updateRun(runId, { currentState: state });
  emit(runId, {
    type: "state_changed",
    message: `State: ${state}`,
    data: { state },
  });
};

export const startTestRun = (config: RunConfig): RunRecord => {
  const run = createRun(config);
  void runTestFlow(run.id, config, { resume: false }).catch((error) => {
    const serialized = serializeError(error);
    setRunStatus(run.id, "failed", serialized.message);
    emit(run.id, {
      type: "error",
      message: serialized.message,
      data: serialized.data,
    });
  });
  return run;
};

export const resumeTestRun = (runId: string): RunRecord => {
  const run = getRun(runId);
  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }
  if (run.status === "completed") {
    throw new Error("Run already completed");
  }
  updateRun(runId, { status: "running", error: undefined, endedAt: undefined });
  emit(runId, { type: "run_resumed", message: "Test agent run resumed" });
  void runTestFlow(runId, run.config, { resume: true }).catch((error) => {
    const serialized = serializeError(error);
    setRunStatus(runId, "failed", serialized.message);
    emit(runId, {
      type: "error",
      message: serialized.message,
      data: serialized.data,
    });
  });
  return run;
};

export const cancelRun = (runId: string) => {
  const run = getRun(runId);
  if (!run) return;
  setRunStatus(runId, "cancelled");
  emit(runId, { type: "run_cancelled", message: "Run cancelled" });
};

const runTestFlow = async (
  runId: string,
  config: RunConfig,
  options: { resume: boolean },
) => {
  if (!options.resume) {
    emit(runId, { type: "run_started", message: "Test agent run started" });
    updateState(runId, "Init Wallet");
  }

  ensureNotCancelled(runId);

  const poolId = config.poolId ?? env.TEST_AGENT_POOL_ID;
  const refAddress = config.refAddress ?? env.NEXT_PUBLIC_REF_ADDR;

  if (!poolId) {
    throw new Error("Missing TEST_AGENT_POOL_ID (set env or provide poolId override)");
  }
  if (!refAddress) {
    throw new Error("Missing NEXT_PUBLIC_REF_ADDR (set env or provide refAddress override)");
  }

  const { agentMnemonic } = loadOrCreateMnemonics();
  const provider = getTestAgentProvider(config.networkId, config.providerHint);
  const providerName = provider?.constructor?.name?.toLowerCase?.() ?? "";
  const evaluator =
    !providerName.includes("koios") &&
    typeof (provider as { evaluateTx?: unknown })?.evaluateTx === "function"
      ? provider
      : undefined;

  const agentWallet: any = new MeshWallet({
    networkId: config.networkId,
    fetcher: provider,
    submitter: provider,
    evaluator,
    key: {
      type: "mnemonic",
      words: buildMnemonicWords(agentMnemonic),
    },
  } as any);

  const walletAdapter = await buildWalletAdapter(agentWallet);
  const walletAddress = await resolveWalletAddress(agentWallet);
  const decoded = deserializeAddress(walletAddress);
  if (!decoded?.pubKeyHash) {
    throw new Error("Unable to resolve proposer key hash from wallet address");
  }

  if (!isStepCompleted(runId, STEP_KEYS.initWallet)) {
    emit(runId, { type: "step_started", message: STEP_KEYS.initWallet });
  }

  updateProgress(runId, { walletAddress });

  if (!isStepCompleted(runId, STEP_KEYS.initWallet)) {
    emit(runId, {
      type: "step_completed",
      message: "Wallet initialized",
      data: { walletAddress },
    });
    markStepCompleted(runId, STEP_KEYS.initWallet);
    updateState(runId, "Init Wallet");
  }

  ensureNotCancelled(runId);

  const govActionType =
    config.govActionType ??
    (config.treasuryWithdrawals ? "TreasuryWithdrawalsAction" : "InfoAction");

  const fundraiseTarget =
    typeof config.fundraiseTargetLovelace === "number"
      ? config.fundraiseTargetLovelace
      : govActionType === "TreasuryWithdrawalsAction"
        ? TREASURY_FUNDRAISE_TARGET
        : 20_000_000;

  let protocolParams: Record<string, unknown> | undefined;
  try {
    protocolParams = await provider.fetchProtocolParameters();
  } catch {
    protocolParams = undefined;
  }
  const stakeRegisterDeposit = Number(
    (protocolParams as { keyDeposit?: number } | undefined)?.keyDeposit ?? 2_000_000,
  );
  const drepRegisterDeposit = Number(
    (protocolParams as { drepDeposit?: number; drep_deposit?: number; poolDeposit?: number } | undefined)
      ?.drepDeposit ??
      (protocolParams as { drep_deposit?: number } | undefined)?.drep_deposit ??
      (protocolParams as { poolDeposit?: number } | undefined)?.poolDeposit ??
      0,
  );
  const govDeposit = Number(
    (protocolParams as { govActionDeposit?: number; gov_action_deposit?: number } | undefined)
      ?.govActionDeposit ??
      (protocolParams as { gov_action_deposit?: number } | undefined)?.gov_action_deposit ??
      20_000_000,
  );
  const treasuryDepositBuffer =
    govActionType === "TreasuryWithdrawalsAction"
      ? stakeRegisterDeposit + drepRegisterDeposit
      : 0;
  const treasuryRequiredTotal =
    fundraiseTarget +
    govDeposit +
    treasuryDepositBuffer +
    REF_SPEND_OUTPUT_LOVELACE +
    REF_STAKE_OUTPUT_LOVELACE +
    COLLATERAL_OUTPUT_LOVELACE +
    TREASURY_FEE_BUFFER;

  const faucetAmount =
    config.amountLovelace ??
    (govActionType === "TreasuryWithdrawalsAction"
      ? treasuryRequiredTotal
      : DEFAULT_FAUCET_AMOUNT);
  const faucetMaxSend =
    typeof env.FAUCET_MAX_SEND_LOVELACE === "number"
      ? env.FAUCET_MAX_SEND_LOVELACE
      : govActionType === "TreasuryWithdrawalsAction"
        ? 50_000_000_000
        : 200_000_000;
  let progress = getProgress(runId);

  if (!isStepCompleted(runId, STEP_KEYS.faucet)) {
    emit(runId, { type: "step_started", message: STEP_KEYS.faucet });
    let confirmedTotal = progress.faucetAmountLovelace ?? 0;

    while (confirmedTotal < faucetAmount) {
      progress = getProgress(runId);
      if (!progress.faucetTxHash) {
        const remaining = faucetAmount - confirmedTotal;
        const requestAmount = Math.min(remaining, faucetMaxSend);
        updateProgress(runId, { faucetPendingAmountLovelace: requestAmount });
        emit(runId, {
          type: "log",
          message: "Preparing faucet transfer",
          data: {
            networkId: config.networkId,
            faucetAddress: await (async () => {
              try {
                const { faucetMnemonic } = loadOrCreateMnemonics();
                const tempWallet: any = new MeshWallet({
                  networkId: config.networkId,
                  fetcher: provider,
                  submitter: provider,
                  evaluator,
                  key: { type: "mnemonic", words: buildMnemonicWords(faucetMnemonic) },
                } as any);
                return resolveWalletAddress(tempWallet);
              } catch {
                return "unknown";
              }
            })(),
            provider: provider?.constructor?.name ?? "UnknownProvider",
            requestedAmount: requestAmount,
            targetAmount: faucetAmount,
            alreadyFunded: confirmedTotal,
          },
        });
        const faucetResult = await sendFaucetFunds(
          {
            address: walletAddress,
            amountLovelace: requestAmount,
            networkId: config.networkId,
          },
          config.providerHint,
        );
        updateProgress(runId, {
          faucetTxHash: faucetResult.txHash,
          faucetPendingAmountLovelace: requestAmount,
        });
        emit(runId, {
          type: "log",
          message: `Faucet tx submitted: ${faucetResult.txHash}`,
        });
      }

      progress = getProgress(runId);
      if (progress.faucetTxHash) {
        const pendingAmount =
          progress.faucetPendingAmountLovelace ??
          Math.min(faucetAmount - confirmedTotal, faucetMaxSend);
        await waitForConfirmation(progress.faucetTxHash, provider, {
          addresses: [walletAddress],
        });
        confirmedTotal = (progress.faucetAmountLovelace ?? confirmedTotal) + pendingAmount;
        updateProgress(runId, {
          faucetTxHash: undefined,
          faucetAmountLovelace: confirmedTotal,
          faucetPendingAmountLovelace: undefined,
        });
        emit(runId, {
          type: "log",
          message: `Faucet chunk confirmed: ${pendingAmount.toString()}`,
          data: { amountLovelace: pendingAmount, totalLovelace: confirmedTotal },
        });
      }
    }

    emit(runId, {
      type: "step_completed",
      message: "Faucet funds confirmed",
      data: {
        amountLovelace: confirmedTotal,
      },
    });
    markStepCompleted(runId, STEP_KEYS.faucet);
    updateState(runId, "Faucet Funded");
  }

  ensureNotCancelled(runId);

  const meshTxBuilder = new MeshTxBuilder({
    fetcher: provider,
    evaluator,
    submitter: provider,
    verbose: true,
  });
  meshTxBuilder.setNetwork(config.networkId === 1 ? "mainnet" : "preprod");

  const stopAfterPropose =
    typeof config.stopAfterPropose === "boolean"
      ? config.stopAfterPropose
      : govActionType === "TreasuryWithdrawalsAction";

  let treasuryWithdrawals: Record<string, string> | undefined;
  if (govActionType === "TreasuryWithdrawalsAction") {
    const rawWithdrawals =
      config.treasuryWithdrawals &&
      Object.keys(config.treasuryWithdrawals).length > 0
        ? Object.fromEntries(
            Object.entries(config.treasuryWithdrawals).map(([addr, amount]) => [
              addr,
              typeof amount === "string" ? amount : String(amount),
            ]),
          )
        : (() => {
            const rewardAddress = resolveRewardAddress(
              walletAddress,
              config.networkId,
            );
            return { [rewardAddress]: "2000000" };
          })();

    treasuryWithdrawals = normalizeTreasuryWithdrawals(
      rawWithdrawals,
      config.networkId,
    );

    if (
      !treasuryWithdrawals ||
      Object.keys(treasuryWithdrawals).length === 0
    ) {
      throw new Error("TreasuryWithdrawalsAction requires withdrawals");
    }
  }

  updateProgress(runId, {
    govActionType,
    treasuryWithdrawals,
  });

  const treasuryPolicyHash =
    govActionType === "TreasuryWithdrawalsAction" &&
    typeof env.NEXT_PUBLIC_GUARDRAILS_POLICY_HASH === "string" &&
    env.NEXT_PUBLIC_GUARDRAILS_POLICY_HASH.trim().length > 0
      ? scriptHash(env.NEXT_PUBLIC_GUARDRAILS_POLICY_HASH.trim())
      : undefined;

  const ensureTreasuryReturnAccounts = async () => {
    if (govActionType !== "TreasuryWithdrawalsAction" || !treasuryWithdrawals) {
      return;
    }
    const rewardAddresses = Object.keys(treasuryWithdrawals);
    if (rewardAddresses.length === 0) return;

    const missing: string[] = [];
    const scriptMissing: string[] = [];

    for (const address of rewardAddresses) {
      try {
        const info = await provider.fetchAccountInfo(address);
        if (!info || info.active !== true) {
          const decodedReward = deserializeAddress(address);
          if (decodedReward.scriptHash) {
            scriptMissing.push(address);
          } else {
            missing.push(address);
          }
        }
      } catch {
        const decodedReward = deserializeAddress(address);
        if (decodedReward.scriptHash) {
          scriptMissing.push(address);
        } else {
          missing.push(address);
        }
      }
    }

    if (scriptMissing.length > 0) {
      throw new Error(
        `Treasury withdrawal reward addresses not registered (script): ${scriptMissing.join(", ")}`,
      );
    }
    if (missing.length === 0) return;

    emit(runId, {
      type: "log",
      message: `Registering treasury return accounts: ${missing.join(", ")}`,
      data: { addresses: missing },
    });

    const registerBuilder = new MeshTxBuilder({
      fetcher: provider,
      evaluator,
      submitter: provider,
      verbose: true,
    });
    registerBuilder.setNetwork(config.networkId === 1 ? "mainnet" : "preprod");
    for (const address of missing) {
      registerBuilder.registerStakeCertificate(address);
    }
    const registerTx = await registerBuilder
      .changeAddress(walletAddress)
      .selectUtxosFrom(await walletAdapter.getUtxos())
      .complete();

    const registerSigned = await walletAdapter.signTx(registerTx, true);
    const registerHash = await walletAdapter.submitTx(registerSigned);
    emit(runId, {
      type: "log",
      message: `Return account registration tx submitted: ${registerHash}`,
    });
    await waitForConfirmation(registerHash, provider, {
      addresses: [walletAddress],
    });
    emit(runId, {
      type: "log",
      message: "Return account registration confirmed",
      data: { txHash: registerHash },
    });
  };

  const governanceAction: GovernanceAction =
    govActionType === "TreasuryWithdrawalsAction"
      ? {
          kind: "TreasuryWithdrawalsAction",
          action: {
            withdrawals: treasuryWithdrawals ?? {},
            ...(treasuryPolicyHash ? { policyHash: treasuryPolicyHash } : {}),
          },
        }
      : { kind: "InfoAction", action: {} };

  const defaultAnchor = {
    url: "https://example.com",
    hash: "0".repeat(64),
  };

  const governanceConfig = {
    delegatePoolId: poolId,
    govActionPeriod: 6,
    stakeRegisterDeposit,
    drepRegisterDeposit,
    govDeposit,
    governanceAction,
    ...(govActionType === "TreasuryWithdrawalsAction"
      ? { anchorGovAction: defaultAnchor, anchorDrep: defaultAnchor }
      : {}),
  };

  await ensureTreasuryReturnAccounts();

  const contract = new MeshCrowdfundContract(
    {
      mesh: meshTxBuilder,
      fetcher: provider,
      evaluator,
      wallet: walletAdapter,
      networkId: config.networkId,
    },
    {
      proposerKeyHash: decoded.pubKeyHash,
      governance: governanceConfig,
      refAddress,
      govActionType,
      treasuryBeneficiaries: treasuryWithdrawals
        ? Object.entries(treasuryWithdrawals).map(([address, amount]) => ({
            address,
            amount,
          }))
        : undefined,
    },
  );

  progress = getProgress(runId);
  const hasCrowdfundSetup =
    Boolean(progress.crowdfundSetupTxHash) ||
    isStepCompleted(runId, STEP_KEYS.setupCrowdfund);
  if (progress.paramUtxo && hasCrowdfundSetup) {
    contract.setParamUtxo(progress.paramUtxo);
  }
  if (progress.spendRefScript) {
    contract.setRefSpendTxHash(
      progress.spendRefScript.txHash,
      progress.spendRefScript.outputIndex,
    );
  }
  if (progress.stakeRefScript) {
    contract.setRefStakeTxHash(
      progress.stakeRefScript.txHash,
      progress.stakeRefScript.outputIndex,
    );
  }
  if (progress.crowdfundAddress) {
    contract.crowdfundAddress = progress.crowdfundAddress;
  }

  if (!isStepCompleted(runId, STEP_KEYS.collateral)) {
    emit(runId, { type: "step_started", message: STEP_KEYS.collateral });
    let collateral: unknown[] = [];
    try {
      collateral = (await (walletAdapter as any).getCollateral?.()) ?? [];
    } catch {
      collateral = [];
    }
    if (collateral && collateral.length > 0) {
      emit(runId, {
        type: "step_completed",
        message: "Collateral already available",
        data: { collateralCount: collateral.length },
      });
      markStepCompleted(runId, STEP_KEYS.collateral);
      updateState(runId, "Collateral Ready");
    } else {
      progress = getProgress(runId);
      if (!progress.collateralTxHash) {
        const collateralTx = await contract.setupCollateral();
        const collateralSigned = await walletAdapter.signTx(collateralTx.tx, true);
        const collateralHash = await walletAdapter.submitTx(collateralSigned);
        updateProgress(runId, { collateralTxHash: collateralHash });
        emit(runId, {
          type: "log",
          message: `Collateral tx submitted: ${collateralHash}`,
        });
        progress = getProgress(runId);
      }
      if (progress.collateralTxHash) {
        await waitForConfirmation(progress.collateralTxHash, provider, {
          addresses: [walletAddress],
        });
        emit(runId, { type: "step_completed", message: "Collateral confirmed" });
        markStepCompleted(runId, STEP_KEYS.collateral);
        updateState(runId, "Collateral Ready");
      }
    }
  }

  ensureNotCancelled(runId);

  type CrowdfundRecord = {
    id: string;
    proposerKeyHashR0: string;
    datum: string | null;
    govDatum: string | null;
    paramUtxo: string | null;
    spendRefScript: string | null;
    stakeRefScript: string | null;
    address: string | null;
    authTokenId: string | null;
  };

  let crowdfundRecord: CrowdfundRecord | null = null;

  const loadCrowdfundRecord = async (): Promise<CrowdfundRecord | null> => {
    const current = getProgress(runId);
    if (current.crowdfundId) {
      const record = await db.crowdfund.findUnique({
        where: { id: current.crowdfundId },
      });
      return record as CrowdfundRecord | null;
    }
    if (current.paramUtxo) {
      const record = await db.crowdfund.findFirst({
        where: { paramUtxo: JSON.stringify(current.paramUtxo) },
      });
      return record as CrowdfundRecord | null;
    }
    if (current.crowdfundAddress) {
      const record = await db.crowdfund.findFirst({
        where: { address: current.crowdfundAddress },
      });
      return record as CrowdfundRecord | null;
    }
    return null;
  };

  const maybeWithdrawPriorCrowdfund = async (): Promise<boolean> => {
    const currentProgress = getProgress(runId);
    if (currentProgress.crowdfundId || currentProgress.crowdfundSetupTxHash) {
      return false;
    }

    const previousCrowdfunds = await db.crowdfund.findMany({
      where: {
        proposerKeyHashR0: decoded.pubKeyHash,
        govState: { gte: 0 },
      },
      orderBy: { createdAt: "desc" },
    });

    for (const previous of previousCrowdfunds) {
      if (!previous || previous.id === currentProgress.crowdfundId) continue;
      if (!previous.datum || !previous.paramUtxo || !previous.spendRefScript) {
        throw new Error(
          "Cannot withdraw previous crowdfund: missing datum/paramUtxo/spendRefScript.",
        );
      }
      if (!previous.address) {
        throw new Error(
          "Cannot withdraw previous crowdfund: missing crowdfund address.",
        );
      }
      if (!previous.govDatum) {
        throw new Error(
          "Cannot withdraw previous crowdfund: missing govDatum (original governance config).",
        );
      }

      const previousDatum = parseJson<CrowdfundDatumTS>(previous.datum);
      if (!previousDatum || !previousDatum.current_fundraised_amount) continue;
      const withdrawAmount = previousDatum.current_fundraised_amount;
      if (withdrawAmount <= 0) continue;
      if (!previousDatum.share_token) {
        throw new Error(
          `Cannot withdraw previous crowdfund ${previous.id}: missing share_token in datum.`,
        );
      }

      // Ensure the wallet has the share tokens needed to burn.
      const requiredBurn = BigInt(withdrawAmount);
      const utxos = await walletAdapter.getUtxos().catch(() => []);
      const availableBurn = Array.isArray(utxos)
        ? utxos.reduce((sum: bigint, utxo: any) => {
            const match = utxo?.output?.amount?.find(
              (asset: { unit?: string; quantity?: string }) =>
                asset.unit === previousDatum.share_token,
            );
            if (!match) return sum;
            try {
              return sum + BigInt(match.quantity ?? "0");
            } catch {
              return sum;
            }
          }, 0n)
        : 0n;

      if (availableBurn < requiredBurn) {
        const message =
          `Waiting for share tokens to withdraw previous crowdfund ${previous.id}. ` +
          `Required: ${requiredBurn.toString()}, available: ${availableBurn.toString()}, ` +
          `policy: ${previousDatum.share_token}.`;
        setRunStatus(runId, "waiting");
        emit(runId, {
          type: "run_waiting",
          message,
          data: {
            runId,
            crowdfundId: previous.id,
            shareTokenPolicy: previousDatum.share_token,
            requiredBurn: requiredBurn.toString(),
            availableBurn: availableBurn.toString(),
          },
        });
        return true;
      }

      const previousGovExtension = parseJson<RawGovExtension>(previous.govDatum);
      if (!previousGovExtension) {
        throw new Error(
          "Cannot withdraw previous crowdfund: invalid govDatum JSON.",
        );
      }
      if (!previousGovExtension.delegate_pool_id) {
        throw new Error(
          "Cannot withdraw previous crowdfund: govDatum missing delegate_pool_id.",
        );
      }

      const previousGovAction = normalizeGovAction(previousGovExtension.gov_action, {
        preserveLegacyPolicyHash: true,
      });
      if (!previousGovAction) {
        throw new Error(
          "Cannot withdraw previous crowdfund: govDatum missing gov_action.",
        );
      }

      const previousGovActionType =
        previousGovAction.kind === "TreasuryWithdrawalsAction"
          ? "TreasuryWithdrawalsAction"
          : "InfoAction";

      const previousWithdrawals =
        previousGovAction.kind === "TreasuryWithdrawalsAction"
          ? normalizeTreasuryWithdrawals(
              previousGovAction.action?.withdrawals || {},
              config.networkId,
            )
          : undefined;

      if (
        previousGovAction.kind === "TreasuryWithdrawalsAction" &&
        (!previousWithdrawals || Object.keys(previousWithdrawals).length === 0)
      ) {
        throw new Error(
          "Cannot withdraw previous crowdfund: treasury withdrawals missing in govDatum.",
        );
      }

      const previousGovernanceConfig = {
        delegatePoolId: previousGovExtension.delegate_pool_id,
        govActionPeriod: toNumber(previousGovExtension.gov_action_period, 6),
        stakeRegisterDeposit: toNumber(
          previousGovExtension.stake_register_deposit,
          2_000_000,
        ),
        drepRegisterDeposit: toNumber(
          previousGovExtension.drep_register_deposit,
          500_000_000,
        ),
        govDeposit: toNumber(previousGovExtension.gov_deposit, 0),
        governanceAction: previousGovAction,
        anchorGovAction:
          previousGovExtension.govActionMetadataUrl &&
          previousGovExtension.govActionMetadataHash
            ? {
                url: previousGovExtension.govActionMetadataUrl,
                hash: previousGovExtension.govActionMetadataHash,
              }
            : undefined,
        anchorDrep:
          previousGovExtension.drepMetadataUrl &&
          previousGovExtension.drepMetadataHash
            ? {
                url: previousGovExtension.drepMetadataUrl,
                hash: previousGovExtension.drepMetadataHash,
              }
            : undefined,
      };

      const previousParam = parseJson<{ txHash: string; outputIndex: number }>(
        previous.paramUtxo,
      );
      const previousSpendRef = parseJson<{ txHash: string; outputIndex: number }>(
        previous.spendRefScript,
      );
      if (!previousParam || !previousSpendRef) {
        throw new Error(
          "Cannot withdraw previous crowdfund: invalid paramUtxo or spendRefScript.",
        );
      }

      emit(runId, {
        type: "log",
        message: `Withdrawing previous crowdfund ${previous.id} before setup`,
        data: { crowdfundId: previous.id, withdrawAmount },
      });

      const withdrawContract = new MeshCrowdfundContract(
        {
          mesh: meshTxBuilder,
          fetcher: provider,
          evaluator,
          wallet: walletAdapter,
          networkId: config.networkId,
        },
        {
          proposerKeyHash: decoded.pubKeyHash,
          governance: previousGovernanceConfig,
          refAddress,
          govActionType: previousGovActionType,
          treasuryBeneficiaries: previousWithdrawals
            ? Object.entries(previousWithdrawals).map(([address, amount]) => ({
                address,
                amount,
              }))
            : undefined,
          preservePolicyHash: true,
        },
      );

      withdrawContract.setParamUtxo(previousParam);
      withdrawContract.setRefSpendTxHash(
        previousSpendRef.txHash,
        previousSpendRef.outputIndex,
      );
      withdrawContract.crowdfundAddress = previous.address;

      const withdrawResult = await withdrawContract.withdrawCrowdfund(
        withdrawAmount,
        previousDatum,
      );
      const withdrawSigned = await walletAdapter.signTx(withdrawResult.tx, true);
      const withdrawHash = await walletAdapter.submitTx(withdrawSigned);
      emit(runId, {
        type: "log",
        message: `Previous crowdfund withdraw tx submitted: ${withdrawHash}`,
        data: { txHash: withdrawHash, crowdfundId: previous.id },
      });

      await waitForConfirmation(withdrawHash, provider, {
        addresses: [previous.address],
      });

      const updatedDatum: CrowdfundDatumTS = {
        ...previousDatum,
        current_fundraised_amount:
          previousDatum.current_fundraised_amount - withdrawAmount,
      };
      await db.crowdfund.update({
        where: { id: previous.id },
        data: { datum: JSON.stringify(updatedDatum) },
      });

      emit(runId, {
        type: "log",
        message: `Previous crowdfund withdrawal confirmed: ${withdrawHash}`,
        data: { txHash: withdrawHash, crowdfundId: previous.id },
      });
    }
    return false;
  };

  if (!isStepCompleted(runId, STEP_KEYS.setupCrowdfund)) {
    const waitingForTokens = await maybeWithdrawPriorCrowdfund();
    if (waitingForTokens) return;
    emit(runId, { type: "step_started", message: STEP_KEYS.setupCrowdfund });

    progress = getProgress(runId);
    if (!progress.crowdfundSetupTxHash) {
      const now = Date.now();
      const datumData: CrowdfundDatumTS = {
        stake_script: "",
        share_token: "",
        crowdfund_address: "",
        fundraise_target: fundraiseTarget,
        current_fundraised_amount: 0,
        allow_over_subscription: true,
        deadline: now + 7 * 24 * 60 * 60 * 1000,
        expiry_buffer: 86_400,
        min_charge: 2_000_000,
      };

      let setupResult;
      let setupError: unknown;
      const setupAttempts = 3;
      for (let attempt = 1; attempt <= setupAttempts; attempt += 1) {
        try {
          setupResult = await contract.setupCrowdfund(datumData);
          setupError = undefined;
          break;
        } catch (error) {
          setupError = error;
          if (attempt < setupAttempts) {
            emit(runId, {
              type: "log",
              message: `Setup crowdfund build failed (attempt ${attempt}), retrying`,
              data: { attempt, error: String(error) },
            });
            await wait(3_000);
            continue;
          }
        }
      }
      if (setupError || !setupResult) {
        const utxos = await walletAdapter.getUtxos().catch(() => []);
        const totalLovelace = Array.isArray(utxos)
          ? utxos.reduce((sum: bigint, utxo: any) => {
              const lovelace = utxo?.output?.amount?.find(
                (asset: { unit?: string; quantity?: string }) =>
                  asset.unit === "lovelace",
              )?.quantity;
              return sum + BigInt(lovelace ?? "0");
            }, 0n)
          : 0n;
        const wrapped = new Error("Setup crowdfund failed");
        const causeInfo = {
          type: typeof setupError,
          isError: setupError instanceof Error,
          keys:
            setupError && typeof setupError === "object"
              ? Object.keys(setupError as Record<string, unknown>)
              : [],
          string: typeof setupError === "string" ? setupError : undefined,
        };
        (wrapped as { cause?: unknown }).cause = setupError;
        const builderBody = safeJson(
          (contract as { mesh?: { meshTxBuilderBody?: unknown } }).mesh
            ?.meshTxBuilderBody,
        );
        (wrapped as { details?: unknown }).details = {
          step: STEP_KEYS.setupCrowdfund,
          walletAddress,
          utxoCount: Array.isArray(utxos) ? utxos.length : 0,
          totalLovelace: totalLovelace.toString(),
          faucetTarget: faucetAmount,
          faucetConfirmed: getProgress(runId).faucetAmountLovelace ?? 0,
          govActionType,
          attempts: setupAttempts,
          causeInfo,
          builderBody,
        };
        throw wrapped;
      }

      const updatedDatum: CrowdfundDatumTS = {
        stake_script: setupResult.stake_script_hash,
        share_token: setupResult.share_token,
        crowdfund_address: setupResult.crowdfund_address,
        fundraise_target: datumData.fundraise_target,
        current_fundraised_amount: datumData.current_fundraised_amount,
        allow_over_subscription: datumData.allow_over_subscription,
        deadline: datumData.deadline,
        expiry_buffer: datumData.expiry_buffer,
        min_charge: datumData.min_charge,
      };

      const govExtension = {
        gov_action_period: governanceConfig.govActionPeriod,
        delegate_pool_id: governanceConfig.delegatePoolId,
        gov_action: governanceAction,
        stake_register_deposit: governanceConfig.stakeRegisterDeposit,
        drep_register_deposit: governanceConfig.drepRegisterDeposit,
        gov_deposit: governanceConfig.govDeposit,
      };

      updateProgress(runId, {
        paramUtxo: {
          txHash: setupResult.paramUtxo.txHash,
          outputIndex: setupResult.paramUtxo.outputIndex,
        },
        authTokenId: setupResult.authTokenId,
        shareToken: setupResult.share_token,
        stakeScriptHash: setupResult.stake_script_hash,
        crowdfundAddress: setupResult.crowdfund_address,
        crowdfundDatum: updatedDatum as unknown as Record<string, unknown>,
        govExtension: govExtension as unknown as Record<string, unknown>,
      });

      const setupSigned = await walletAdapter.signTx(setupResult.tx, true);
      const setupTxHash = await walletAdapter.submitTx(setupSigned);
      updateProgress(runId, {
        crowdfundSetupTxHash: setupTxHash,
        spendRefScript: { txHash: setupTxHash, outputIndex: 1 },
      });
      contract.setRefSpendTxHash(setupTxHash, 1);
      contract.crowdfundAddress = setupResult.crowdfund_address;

      emit(runId, {
        type: "log",
        message: `Crowdfund setup tx submitted: ${setupTxHash}`,
      });
    }

    progress = getProgress(runId);
    if (progress.crowdfundSetupTxHash) {
      await waitForConfirmation(progress.crowdfundSetupTxHash, provider, {
        addresses: [progress.crowdfundAddress, refAddress].filter(
          (addr): addr is string => typeof addr === "string" && addr.length > 0,
        ),
      });
      crowdfundRecord = await loadCrowdfundRecord();
      if (!crowdfundRecord) {
        const updatedDatum = progress.crowdfundDatum as CrowdfundDatumTS | undefined;
        if (!updatedDatum || !progress.paramUtxo) {
          throw new Error("Missing crowdfund setup context to resume");
        }
        const record = await db.crowdfund.create({
          data: {
            name: `Agent Smoke ${new Date().toISOString()}`,
            description: "Automated smoke test",
            proposerKeyHashR0: decoded.pubKeyHash,
            paramUtxo: JSON.stringify(progress.paramUtxo),
            authTokenId: progress.authTokenId ?? undefined,
            address: progress.crowdfundAddress ?? undefined,
            datum: JSON.stringify(updatedDatum),
            govDatum: progress.govExtension ? JSON.stringify(progress.govExtension) : undefined,
            spendRefScript: progress.spendRefScript
              ? JSON.stringify(progress.spendRefScript)
              : JSON.stringify({ txHash: progress.crowdfundSetupTxHash, outputIndex: 1 }),
            refAddress,
          },
        });
        crowdfundRecord = record as CrowdfundRecord;
        updateProgress(runId, { crowdfundId: record.id });
      } else if (progress.crowdfundId !== crowdfundRecord.id) {
        updateProgress(runId, { crowdfundId: crowdfundRecord.id });
      }

      emit(runId, {
        type: "step_completed",
        message: "Crowdfund setup confirmed",
        data: { crowdfundId: crowdfundRecord?.id },
      });
      markStepCompleted(runId, STEP_KEYS.setupCrowdfund);
      updateState(runId, "Crowdfund");
    }
  } else {
    crowdfundRecord = await loadCrowdfundRecord();
  }

  ensureNotCancelled(runId);

  if (!crowdfundRecord) {
    crowdfundRecord = await loadCrowdfundRecord();
  }

  if (
    crowdfundRecord?.proposerKeyHashR0 &&
    crowdfundRecord.proposerKeyHashR0 !== decoded.pubKeyHash
  ) {
    throw new Error(
      "Crowdfund owner mismatch: only the original proposer can register certs.",
    );
  }

  if (crowdfundRecord?.paramUtxo) {
    const param = parseJson<{ txHash: string; outputIndex: number }>(
      crowdfundRecord.paramUtxo,
    );
    if (param) {
      contract.setParamUtxo(param);
      if (!getProgress(runId).paramUtxo) {
        updateProgress(runId, { paramUtxo: param });
      }
    }
  }
  if (crowdfundRecord?.spendRefScript) {
    const ref = parseJson<{ txHash: string; outputIndex: number }>(
      crowdfundRecord.spendRefScript,
    );
    if (ref) {
      contract.setRefSpendTxHash(ref.txHash, ref.outputIndex);
    }
  }
  if (crowdfundRecord?.stakeRefScript) {
    const ref = parseJson<{ txHash: string; outputIndex: number }>(
      crowdfundRecord.stakeRefScript,
    );
    if (ref) {
      contract.setRefStakeTxHash(ref.txHash, ref.outputIndex);
    }
  }
  if (crowdfundRecord?.address) {
    contract.crowdfundAddress = crowdfundRecord.address;
  }

  let currentDatum =
    (parseJson<CrowdfundDatumTS>(crowdfundRecord?.datum ?? undefined) ??
      (getProgress(runId).crowdfundDatum as CrowdfundDatumTS | undefined)) ??
    undefined;

  const isTreasuryFlow = govActionType === "TreasuryWithdrawalsAction";
  const updateCrowdfundDatum = async (nextDatum: CrowdfundDatumTS) => {
    updateProgress(runId, {
      crowdfundDatum: nextDatum as unknown as Record<string, unknown>,
    });
    if (crowdfundRecord?.id) {
      await db.crowdfund.update({
        where: { id: crowdfundRecord.id },
        data: { datum: JSON.stringify(nextDatum) },
      });
    }
    currentDatum = nextDatum;
  };

  if (isTreasuryFlow) {
    if (!currentDatum) {
      throw new Error("Missing crowdfund datum for treasury funding");
    }

    const initialContributeAmount = Math.min(
      CONTRIBUTION_AMOUNT,
      Math.max(0, fundraiseTarget - currentDatum.current_fundraised_amount),
    );
    if (!isStepCompleted(runId, STEP_KEYS.contribute)) {
      emit(runId, { type: "step_started", message: STEP_KEYS.contribute });
      progress = getProgress(runId);
      if (!progress.contributeTxHash) {
        if (initialContributeAmount <= 0) {
          throw new Error("No remaining amount available for initial contribution");
        }
        const contributeResult = await contract.contributeCrowdfund(
          initialContributeAmount,
          currentDatum,
        );
        const contributeSigned = await walletAdapter.signTx(contributeResult.tx, true);
        const contributeHash = await walletAdapter.submitTx(contributeSigned);
        updateProgress(runId, {
          contributeTxHash: contributeHash,
          treasuryInitialContributeAmount: initialContributeAmount,
        });
        emit(runId, {
          type: "log",
          message: `Initial contribution tx submitted: ${contributeHash}`,
        });
        progress = getProgress(runId);
      }
      if (progress.contributeTxHash) {
        const appliedAmount =
          progress.treasuryInitialContributeAmount ?? initialContributeAmount;
        const crowdfundAddress =
          progress.crowdfundAddress ?? contract.crowdfundAddress;
        if (!crowdfundAddress) {
          throw new Error("Missing crowdfund address for contribution confirmation");
        }
        await waitForConfirmation(progress.contributeTxHash, provider, {
          addresses: [crowdfundAddress],
        });
        const contributedDatum: CrowdfundDatumTS = {
          ...currentDatum,
          current_fundraised_amount:
            currentDatum.current_fundraised_amount + appliedAmount,
        };
        await updateCrowdfundDatum(contributedDatum);
        emit(runId, { type: "step_completed", message: "Contribution confirmed" });
        markStepCompleted(runId, STEP_KEYS.contribute);
        updateState(runId, "Contributed");
      }
    }

    ensureNotCancelled(runId);

    const treasuryWithdrawAmount = Math.min(
      WITHDRAW_AMOUNT,
      currentDatum.current_fundraised_amount,
    );
    if (!isStepCompleted(runId, STEP_KEYS.withdraw)) {
      emit(runId, { type: "step_started", message: STEP_KEYS.withdraw });
      progress = getProgress(runId);
      if (!progress.withdrawTxHash) {
        if (!currentDatum) {
          throw new Error("Missing crowdfund datum for withdrawal");
        }
        if (treasuryWithdrawAmount <= 0) {
          throw new Error("No funds available for withdrawal");
        }
        const withdrawResult = await contract.withdrawCrowdfund(
          treasuryWithdrawAmount,
          currentDatum,
        );
        const withdrawSigned = await walletAdapter.signTx(withdrawResult.tx, true);
        const withdrawHash = await walletAdapter.submitTx(withdrawSigned);
        updateProgress(runId, {
          withdrawTxHash: withdrawHash,
          treasuryWithdrawAmount,
        });
        emit(runId, { type: "log", message: `Withdraw tx submitted: ${withdrawHash}` });
        progress = getProgress(runId);
      }

      if (progress.withdrawTxHash) {
        const appliedAmount = progress.treasuryWithdrawAmount ?? treasuryWithdrawAmount;
        const crowdfundAddress =
          progress.crowdfundAddress ?? contract.crowdfundAddress;
        if (!crowdfundAddress) {
          throw new Error("Missing crowdfund address for withdrawal confirmation");
        }
        await waitForConfirmation(progress.withdrawTxHash, provider, {
          addresses: [crowdfundAddress],
        });
        if (!currentDatum) {
          throw new Error("Missing crowdfund datum after withdrawal");
        }
        const withdrawnDatum: CrowdfundDatumTS = {
          ...currentDatum,
          current_fundraised_amount:
            currentDatum.current_fundraised_amount - appliedAmount,
        };
        await updateCrowdfundDatum(withdrawnDatum);
        emit(runId, { type: "step_completed", message: "Withdrawal confirmed" });
        markStepCompleted(runId, STEP_KEYS.withdraw);
        updateState(runId, "Withdrawn");
      }
    }

    ensureNotCancelled(runId);

    const remainingToTarget =
      fundraiseTarget - (currentDatum?.current_fundraised_amount ?? 0);
    if (remainingToTarget > 0) {
      progress = getProgress(runId);
      if (!progress.treasuryFinalContributeTxHash) {
        emit(runId, {
          type: "log",
          message: `Final funding contribution started: ${remainingToTarget.toString()}`,
          data: { remainingToTarget },
        });
        const finalResult = await contract.contributeCrowdfund(
          remainingToTarget,
          currentDatum!,
        );
        const finalSigned = await walletAdapter.signTx(finalResult.tx, true);
        const finalHash = await walletAdapter.submitTx(finalSigned);
        updateProgress(runId, {
          treasuryFinalContributeTxHash: finalHash,
          treasuryFinalContributeAmount: remainingToTarget,
        });
        emit(runId, {
          type: "log",
          message: `Final contribution tx submitted: ${finalHash}`,
        });
        progress = getProgress(runId);
      }

      if (progress.treasuryFinalContributeTxHash) {
        const appliedAmount =
          progress.treasuryFinalContributeAmount ?? remainingToTarget;
        const crowdfundAddress =
          progress.crowdfundAddress ?? contract.crowdfundAddress;
        if (!crowdfundAddress) {
          throw new Error("Missing crowdfund address for final contribution confirmation");
        }
        await waitForConfirmation(progress.treasuryFinalContributeTxHash, provider, {
          addresses: [crowdfundAddress],
        });
        const finalDatum: CrowdfundDatumTS = {
          ...currentDatum!,
          current_fundraised_amount:
            (currentDatum?.current_fundraised_amount ?? 0) + appliedAmount,
        };
        await updateCrowdfundDatum(finalDatum);
        emit(runId, {
          type: "log",
          message: "Final contribution confirmed",
          data: { fundedTotal: finalDatum.current_fundraised_amount },
        });
        updateState(runId, "Contributed");
      }
    }

    if (!isStepCompleted(runId, STEP_KEYS.stakeRefScript)) {
      emit(runId, { type: "step_started", message: STEP_KEYS.stakeRefScript });
      progress = getProgress(runId);
      if (options.resume && progress.stakeRefScriptTxHash) {
        const confirmed = await isTxConfirmed(
          progress.stakeRefScriptTxHash,
          provider,
          [refAddress],
        );
        if (!confirmed) {
          emit(runId, {
            type: "log",
            message: "Stake ref script pending too long; resubmitting",
          });
          updateProgress(runId, {
            stakeRefScriptTxHash: undefined,
            stakeRefScript: undefined,
          });
          progress = getProgress(runId);
        }
      }
      if (!progress.stakeRefScriptTxHash) {
        const stakeRefResult = await contract.setupStakeRefScript();
        const stakeRefSigned = await walletAdapter.signTx(stakeRefResult.tx, true);
        const stakeRefHash = await walletAdapter.submitTx(stakeRefSigned);
        updateProgress(runId, {
          stakeRefScriptTxHash: stakeRefHash,
          stakeRefScript: { txHash: stakeRefHash, outputIndex: 0 },
        });
        contract.setRefStakeTxHash(stakeRefHash, 0);
        emit(runId, {
          type: "log",
          message: `Stake ref script tx submitted: ${stakeRefHash}`,
        });
        progress = getProgress(runId);
      }
      if (progress.stakeRefScriptTxHash) {
        await waitForConfirmation(progress.stakeRefScriptTxHash, provider, {
          addresses: [refAddress],
        });
        emit(runId, {
          type: "step_completed",
          message: "Stake ref script confirmed",
        });
        markStepCompleted(runId, STEP_KEYS.stakeRefScript);
      }
    }

    ensureNotCancelled(runId);

    if (!isStepCompleted(runId, STEP_KEYS.registerCerts)) {
      emit(runId, { type: "step_started", message: STEP_KEYS.registerCerts });
      progress = getProgress(runId);
      if (!progress.govActionTxHash) {
        if (!currentDatum) {
          throw new Error("Missing crowdfund datum for register certs");
        }
        const registerResult = await contract.registerCerts({
          datum: currentDatum,
        });
        let parsedSummary: Record<string, unknown> | undefined;
        if (registerResult?.tx) {
          try {
            const parser = new TxParser(
              (meshTxBuilder as any).serializer,
              provider,
            );
            const parsed = await parser.parse(registerResult.tx);
            parsedSummary = {
              parsedInputs: parsed?.inputs?.length ?? 0,
              parsedOutputs: parsed?.outputs?.length ?? 0,
              parsedCertificates: parsed?.certificates?.length ?? 0,
              parsedProposals: parsed?.proposals?.length ?? 0,
              parsedFee: parsed?.fee ?? undefined,
            };
          } catch (parseError) {
            parsedSummary = {
              parseError:
                parseError instanceof Error
                  ? parseError.message
                  : String(parseError),
            };
          }
        }
        if (registerResult?.debug || parsedSummary) {
          emit(runId, {
            type: "log",
            message: "Register certs debug snapshot",
            data: {
              ...(registerResult.debug ?? {}),
              ...(parsedSummary ? { parsedSummary } : {}),
            },
          });
        }
        const registerSigned = await walletAdapter.signTx(registerResult.tx, true);
        const registerHash = await walletAdapter.submitTx(registerSigned);
        updateProgress(runId, {
          govActionTxHash: registerHash,
          govActionId: { txHash: registerHash, index: 0 },
        });
        emit(runId, {
          type: "log",
          message: `Register certs tx submitted: ${registerHash}`,
        });
        progress = getProgress(runId);
      }

      if (progress.govActionTxHash) {
        const crowdfundAddress =
          progress.crowdfundAddress ?? contract.crowdfundAddress;
        if (!crowdfundAddress) {
          throw new Error("Missing crowdfund address for register certs confirmation");
        }
        await waitForConfirmation(progress.govActionTxHash, provider, {
          addresses: [crowdfundAddress],
        });
        emit(runId, { type: "step_completed", message: "Register certs confirmed" });
        markStepCompleted(runId, STEP_KEYS.registerCerts);
        updateState(runId, "Proposed");
        if (crowdfundRecord?.id && progress.govActionId) {
          await db.crowdfund.update({
            where: { id: crowdfundRecord.id },
            data: {
              govActionId: JSON.stringify(progress.govActionId),
              govState: 2,
              stakeRefScript: progress.stakeRefScript
                ? JSON.stringify(progress.stakeRefScript)
                : undefined,
            },
          });
        }
      }
    }

    if (stopAfterPropose) {
      setRunStatus(runId, "waiting");
      emit(runId, {
        type: "run_waiting",
        message: "Run waiting for ratification",
        data: { runId },
      });
      return;
    }

    ensureNotCancelled(runId);

    if (!isStepCompleted(runId, STEP_KEYS.vote)) {
      emit(runId, { type: "step_started", message: STEP_KEYS.vote });
      if (!currentDatum) {
        throw new Error("Missing crowdfund datum for vote");
      }
      const voteResult = await contract.voteOnGovAction({
        datum: currentDatum as any,
        voteKind: "Yes",
      });
      const voteSigned = await walletAdapter.signTx(voteResult.tx, true);
      const voteHash = await walletAdapter.submitTx(voteSigned);
      emit(runId, { type: "log", message: `Vote tx submitted: ${voteHash}` });
      const crowdfundAddress = progress.crowdfundAddress ?? contract.crowdfundAddress;
      if (!crowdfundAddress) {
        throw new Error("Missing crowdfund address for vote confirmation");
      }
      await waitForConfirmation(voteHash, provider, {
        addresses: [crowdfundAddress],
      });
      emit(runId, { type: "step_completed", message: "Vote confirmed" });
      markStepCompleted(runId, STEP_KEYS.vote);
      updateState(runId, "Voted");
      if (crowdfundRecord?.id) {
        await db.crowdfund.update({
          where: { id: crowdfundRecord.id },
          data: { govState: 3 },
        });
      }
    }

    ensureNotCancelled(runId);

    if (!isStepCompleted(runId, STEP_KEYS.deregister)) {
      emit(runId, { type: "step_started", message: STEP_KEYS.deregister });
      if (!currentDatum) {
        throw new Error("Missing crowdfund datum for deregister");
      }
      const deregisterResult = await contract.deregisterGovAction({
        datum: currentDatum as any,
      });
      const deregisterSigned = await walletAdapter.signTx(deregisterResult.tx, true);
      const deregisterHash = await walletAdapter.submitTx(deregisterSigned);
      emit(runId, { type: "log", message: `Deregister tx submitted: ${deregisterHash}` });
      const crowdfundAddress =
        progress.crowdfundAddress ?? contract.crowdfundAddress;
      if (!crowdfundAddress) {
        throw new Error("Missing crowdfund address for deregister confirmation");
      }
      await waitForConfirmation(deregisterHash, provider, {
        addresses: [crowdfundAddress],
      });
      emit(runId, { type: "step_completed", message: "Deregister confirmed" });
      markStepCompleted(runId, STEP_KEYS.deregister);
      updateState(runId, "Refundable");
      if (crowdfundRecord?.id) {
        await db.crowdfund.update({
          where: { id: crowdfundRecord.id },
          data: { govState: 4 },
        });
      }
    }

    setRunStatus(runId, "completed");
    emit(runId, { type: "run_completed", message: "Run completed" });
    return;
  }

  if (!isStepCompleted(runId, STEP_KEYS.contribute)) {
    emit(runId, { type: "step_started", message: STEP_KEYS.contribute });
    progress = getProgress(runId);
    if (!progress.contributeTxHash) {
      if (!currentDatum) {
        throw new Error("Missing crowdfund datum for contribution");
      }
      const contributeResult = await contract.contributeCrowdfund(
        CONTRIBUTION_AMOUNT,
        currentDatum,
      );
      const contributeSigned = await walletAdapter.signTx(contributeResult.tx, true);
      const contributeHash = await walletAdapter.submitTx(contributeSigned);
      updateProgress(runId, { contributeTxHash: contributeHash });
      emit(runId, {
        type: "log",
        message: `Contribution tx submitted: ${contributeHash}`,
      });
      progress = getProgress(runId);
    }

    if (progress.contributeTxHash) {
      const crowdfundAddress =
        progress.crowdfundAddress ?? contract.crowdfundAddress;
      if (!crowdfundAddress) {
        throw new Error("Missing crowdfund address for contribution confirmation");
      }
      await waitForConfirmation(progress.contributeTxHash, provider, {
        addresses: [crowdfundAddress],
      });
      if (currentDatum) {
        const contributedDatum: CrowdfundDatumTS = {
          ...currentDatum,
          current_fundraised_amount:
            currentDatum.current_fundraised_amount + CONTRIBUTION_AMOUNT,
        };
        updateProgress(runId, {
          crowdfundDatum: contributedDatum as unknown as Record<string, unknown>,
        });
        if (crowdfundRecord?.id) {
          await db.crowdfund.update({
            where: { id: crowdfundRecord.id },
            data: { datum: JSON.stringify(contributedDatum) },
          });
        }
        currentDatum = contributedDatum;
      }
      emit(runId, { type: "step_completed", message: "Contribution confirmed" });
      markStepCompleted(runId, STEP_KEYS.contribute);
      updateState(runId, "Contributed");
    }
  }

  ensureNotCancelled(runId);

  if (!isStepCompleted(runId, STEP_KEYS.withdraw)) {
    emit(runId, { type: "step_started", message: STEP_KEYS.withdraw });
    progress = getProgress(runId);
    if (!progress.withdrawTxHash) {
      if (!currentDatum) {
        throw new Error("Missing crowdfund datum for withdrawal");
      }
      const withdrawResult = await contract.withdrawCrowdfund(
        WITHDRAW_AMOUNT,
        currentDatum,
      );
      const withdrawSigned = await walletAdapter.signTx(withdrawResult.tx, true);
      const withdrawHash = await walletAdapter.submitTx(withdrawSigned);
      updateProgress(runId, { withdrawTxHash: withdrawHash });
      emit(runId, { type: "log", message: `Withdraw tx submitted: ${withdrawHash}` });
      progress = getProgress(runId);
    }

    if (progress.withdrawTxHash) {
      const crowdfundAddress =
        progress.crowdfundAddress ?? contract.crowdfundAddress;
      if (!crowdfundAddress) {
        throw new Error("Missing crowdfund address for withdrawal confirmation");
      }
      await waitForConfirmation(progress.withdrawTxHash, provider, {
        addresses: [crowdfundAddress],
      });
      if (currentDatum) {
        const withdrawnDatum: CrowdfundDatumTS = {
          ...currentDatum,
          current_fundraised_amount:
            currentDatum.current_fundraised_amount - WITHDRAW_AMOUNT,
        };
        updateProgress(runId, {
          crowdfundDatum: withdrawnDatum as unknown as Record<string, unknown>,
        });
        if (crowdfundRecord?.id) {
          await db.crowdfund.update({
            where: { id: crowdfundRecord.id },
            data: { datum: JSON.stringify(withdrawnDatum) },
          });
        }
        currentDatum = withdrawnDatum;
      }
      emit(runId, { type: "step_completed", message: "Withdrawal confirmed" });
      markStepCompleted(runId, STEP_KEYS.withdraw);
      updateState(runId, "Withdrawn");
    }
  }

  setRunStatus(runId, "completed");
  emit(runId, { type: "run_completed", message: "Run completed" });
};
