import { MeshCrowdfundContract } from "@/components/crowdfund/offchain";
import type { CrowdfundDatumTS } from "@/components/crowdfund/crowdfund";
import { env } from "@/env";
import { getTestAgentProvider } from "@/server/test-agent/provider";
import { db } from "@/server/db";
import {
  MeshTxBuilder,
  MeshWallet,
  deserializeAddress,
} from "@meshsdk/core";
import type { GovernanceAction } from "@meshsdk/common";

import type { AgentEvent, GovState, RunConfig, RunRecord, RunProgress } from "./types";
import { addEvent, createRun, getRun, setRunStatus, updateRun } from "./state";
import { sendFaucetFunds } from "./faucet";
import { loadOrCreateMnemonics } from "./keys";

const DEFAULT_FAUCET_AMOUNT = 200_000_000; // 200 ADA
const CONTRIBUTION_AMOUNT = 5_000_000; // 5 ADA
const WITHDRAW_AMOUNT = 2_000_000; // 2 ADA

const STEP_KEYS = {
  initWallet: "Initialize wallet",
  faucet: "Request faucet funds",
  collateral: "Setup collateral",
  setupCrowdfund: "Setup crowdfund",
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

const waitForConfirmation = async (
  txHash: string,
  provider: any,
  maxWaitMs?: number,
) => {
  const providerName = provider?.constructor?.name?.toLowerCase?.() ?? "";
  const isKoios = providerName.includes("koios");
  const timeoutMs =
    typeof maxWaitMs === "number" && maxWaitMs > 0
      ? maxWaitMs
      : isKoios
        ? 300_000
        : 120_000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const info = await provider.fetchTxInfo(txHash);
      if (info) return;
    } catch {
      // Ignore and retry
    }
    await wait(2_000);
  }
  throw new Error(
    `Transaction ${txHash} not confirmed within ${timeoutMs}ms`,
  );
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
  const evaluator =
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

  const faucetAmount = config.amountLovelace ?? DEFAULT_FAUCET_AMOUNT;
  let progress = getProgress(runId);

  if (!isStepCompleted(runId, STEP_KEYS.faucet)) {
    emit(runId, { type: "step_started", message: STEP_KEYS.faucet });
    if (!progress.faucetTxHash) {
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
          requestedAmount: faucetAmount,
        },
      });
      const faucetResult = await sendFaucetFunds(
        {
          address: walletAddress,
          amountLovelace: faucetAmount,
          networkId: config.networkId,
        },
        config.providerHint,
      );
      updateProgress(runId, {
        faucetTxHash: faucetResult.txHash,
        faucetAmountLovelace: faucetResult.amountLovelace,
      });
      emit(runId, {
        type: "log",
        message: `Faucet tx submitted: ${faucetResult.txHash}`,
      });
      progress = getProgress(runId);
    }

    if (progress.faucetTxHash) {
      await waitForConfirmation(progress.faucetTxHash, provider);
      emit(runId, {
        type: "step_completed",
        message: "Faucet funds confirmed",
        data: {
          txHash: progress.faucetTxHash,
          amountLovelace: progress.faucetAmountLovelace ?? faucetAmount,
        },
      });
      markStepCompleted(runId, STEP_KEYS.faucet);
      updateState(runId, "Faucet Funded");
    }
  }

  ensureNotCancelled(runId);

  const meshTxBuilder = new MeshTxBuilder({
    fetcher: provider,
    evaluator,
    submitter: provider,
    verbose: true,
  });
  meshTxBuilder.setNetwork(config.networkId === 1 ? "mainnet" : "preprod");

  const governanceAction: GovernanceAction = { kind: "InfoAction", action: {} };

  const governanceConfig = {
    delegatePoolId: poolId,
    govActionPeriod: 6,
    stakeRegisterDeposit: 2_000_000,
    drepRegisterDeposit: 500_000_000,
    govDeposit: 20_000_000,
    governanceAction,
  };

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
      govActionType: "InfoAction",
    },
  );

  progress = getProgress(runId);
  if (progress.paramUtxo) {
    contract.setParamUtxo(progress.paramUtxo);
  }
  if (progress.spendRefScript) {
    contract.setRefSpendTxHash(
      progress.spendRefScript.txHash,
      progress.spendRefScript.outputIndex,
    );
  }
  if (progress.crowdfundAddress) {
    contract.crowdfundAddress = progress.crowdfundAddress;
  }

  if (!isStepCompleted(runId, STEP_KEYS.collateral)) {
    emit(runId, { type: "step_started", message: STEP_KEYS.collateral });
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
      await waitForConfirmation(progress.collateralTxHash, provider);
      emit(runId, { type: "step_completed", message: "Collateral confirmed" });
      markStepCompleted(runId, STEP_KEYS.collateral);
      updateState(runId, "Collateral Ready");
    }
  }

  ensureNotCancelled(runId);

  let crowdfundRecord = null as null | {
    id: string;
    datum: string | null;
    govDatum: string | null;
    paramUtxo: string | null;
    spendRefScript: string | null;
    address: string | null;
    authTokenId: string | null;
  };

  const loadCrowdfundRecord = async (): Promise<typeof crowdfundRecord> => {
    const current = getProgress(runId);
    if (current.crowdfundId) {
      const record = await db.crowdfund.findUnique({
        where: { id: current.crowdfundId },
      });
      return record as typeof crowdfundRecord;
    }
    if (current.paramUtxo) {
      const record = await db.crowdfund.findFirst({
        where: { paramUtxo: JSON.stringify(current.paramUtxo) },
      });
      return record as typeof crowdfundRecord;
    }
    if (current.crowdfundAddress) {
      const record = await db.crowdfund.findFirst({
        where: { address: current.crowdfundAddress },
      });
      return record as typeof crowdfundRecord;
    }
    return null;
  };

  if (!isStepCompleted(runId, STEP_KEYS.setupCrowdfund)) {
    emit(runId, { type: "step_started", message: STEP_KEYS.setupCrowdfund });

    progress = getProgress(runId);
    if (!progress.crowdfundSetupTxHash) {
      const now = Date.now();
      const datumData: CrowdfundDatumTS = {
        stake_script: "",
        share_token: "",
        crowdfund_address: "",
        fundraise_target: 20_000_000,
        current_fundraised_amount: 0,
        allow_over_subscription: true,
        deadline: now + 7 * 24 * 60 * 60 * 1000,
        expiry_buffer: 86_400,
        min_charge: 2_000_000,
      };

      const setupResult = await contract.setupCrowdfund(datumData);

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
      await waitForConfirmation(progress.crowdfundSetupTxHash, provider);
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
        crowdfundRecord = record as typeof crowdfundRecord;
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

  if (crowdfundRecord?.paramUtxo) {
    const param = parseJson<{ txHash: string; outputIndex: number }>(
      crowdfundRecord.paramUtxo,
    );
    if (param) {
      contract.setParamUtxo(param);
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
  if (crowdfundRecord?.address) {
    contract.crowdfundAddress = crowdfundRecord.address;
  }

  let currentDatum =
    (parseJson<CrowdfundDatumTS>(crowdfundRecord?.datum ?? undefined) ??
      (getProgress(runId).crowdfundDatum as CrowdfundDatumTS | undefined)) ??
    undefined;

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
      await waitForConfirmation(progress.contributeTxHash, provider);
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
      await waitForConfirmation(progress.withdrawTxHash, provider);
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
