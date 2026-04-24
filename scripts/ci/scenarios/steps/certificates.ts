import type { CIBootstrapContext, CIWalletType, RouteStep, Scenario } from "../../framework/types";
import { requestJson } from "../../framework/http";
import { runSigningFlow } from "../flows/signingFlow";
import { runStakeCertSigningFlow } from "../flows/certificateSigningFlow";
import { getDefaultBot } from "../../framework/botContext";
import { authenticateBot } from "../../framework/botAuth";
import { stringifyRedacted } from "../../framework/redact";
import { boolFromEnv } from "../../framework/env";
import { hashDrepAnchor } from "@meshsdk/core";

type ScriptUtxo = {
  input: { txHash: string; outputIndex: number };
  output: { address: string; amount: { unit: string; quantity: string }[] };
};

async function fetchUtxoRefs(args: {
  ctx: CIBootstrapContext;
  walletId: string;
  token: string;
  botAddress: string;
  fresh?: boolean;
}): Promise<{ txHash: string; outputIndex: number }[]> {
  const { ctx, walletId, token, botAddress } = args;
  const freshParam = args.fresh ? "&fresh=true" : "";
  const response = await requestJson<ScriptUtxo[] | { error?: string }>({
    url: `${ctx.apiBaseUrl}/api/v1/freeUtxos?walletId=${encodeURIComponent(walletId)}&address=${encodeURIComponent(botAddress)}${freshParam}`,
    method: "GET",
    token,
  });
  if (response.status !== 200 || !Array.isArray(response.data)) {
    throw new Error(
      `freeUtxos preflight failed (${response.status}): ${stringifyRedacted(response.data)}`,
    );
  }
  if (response.data.length === 0) {
    throw new Error("No free UTxOs available in wallet for certificate transaction");
  }
  return response.data.map((u) => ({ txHash: u.input.txHash, outputIndex: u.input.outputIndex }));
}

/**
 * Polls freeUtxos?fresh=true until none of the given spent UTxO refs appear in
 * the result. This confirms the cert tx has been included in a block and its
 * inputs are no longer unspent on-chain.
 *
 * Preprod block time is ~20 s. We retry every 8 s for up to 4 minutes.
 */
async function pollUntilUtxosConsumed(args: {
  ctx: CIBootstrapContext;
  walletId: string;
  token: string;
  botAddress: string;
  spentUtxoRefs: { txHash: string; outputIndex: number }[];
  maxRetries?: number;
  retryDelayMs?: number;
}): Promise<{ attempts: number }> {
  const { ctx, walletId, token, botAddress, spentUtxoRefs } = args;
  const maxRetries = args.maxRetries ?? 30;
  const retryDelayMs = args.retryDelayMs ?? 8000;
  const spentKeys = new Set(spentUtxoRefs.map((r) => `${r.txHash}:${r.outputIndex}`));

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
    }
    const response = await requestJson<ScriptUtxo[] | { error?: string }>({
      url: `${ctx.apiBaseUrl}/api/v1/freeUtxos?walletId=${encodeURIComponent(walletId)}&address=${encodeURIComponent(botAddress)}&fresh=true`,
      method: "GET",
      token,
    });
    if (response.status !== 200 || !Array.isArray(response.data)) {
      continue;
    }
    const hasOverlap = response.data.some((u) =>
      spentKeys.has(`${u.input.txHash}:${u.input.outputIndex}`),
    );
    if (!hasOverlap) {
      return { attempts: attempt + 1 };
    }
  }
  throw new Error(
    `Timed out after ${maxRetries} attempts (${(maxRetries * (args.retryDelayMs ?? 8000)) / 1000}s) waiting for cert tx inputs to be confirmed on-chain`,
  );
}

function createCertSigningStep(args: {
  id: string;
  description: string;
  signerIndex: 1 | 2;
  mnemonicEnvName: "CI_MNEMONIC_2" | "CI_MNEMONIC_3";
  walletType: CIWalletType;
  signBroadcast: boolean;
  requireBroadcastSuccess: boolean;
  getTransactionId: () => string | undefined;
  /** When true, use the stake-cert signing flow that submits both payment and stake key witnesses. */
  useStakeCertFlow?: boolean;
}): RouteStep {
  return {
    id: args.id,
    description: args.description,
    severity: "critical",
    execute: async (ctx) => {
      const mnemonic = process.env[args.mnemonicEnvName];
      if (!mnemonic?.trim()) {
        throw new Error(`${args.mnemonicEnvName} is required for certificate signing`);
      }
      const txId = args.getTransactionId();
      if (!txId) {
        throw new Error(`No transaction id available for signing step ${args.id}`);
      }
      const effectiveBroadcast = args.signBroadcast && boolFromEnv(process.env.SIGN_BROADCAST, true);

      if (args.useStakeCertFlow) {
        const result = await runStakeCertSigningFlow({
          ctx,
          mnemonic,
          signerIndex: args.signerIndex,
          signBroadcast: effectiveBroadcast,
          preferredTransactionId: txId,
          requireBroadcastSuccess: args.requireBroadcastSuccess,
        });
        return {
          message: `Stake cert sign (signer${args.signerIndex}) status=${result.status} submitted=${String(result.submitted)} stakeWitness=${String(result.stakeWitnessIncluded)}`,
          artifacts: result as unknown as Record<string, unknown>,
        };
      }

      const result = await runSigningFlow({
        ctx,
        mnemonic,
        signWalletType: args.walletType,
        signerIndex: args.signerIndex,
        signerLabel: `signer${args.signerIndex}`,
        signBroadcast: effectiveBroadcast,
        preferredTransactionId: txId,
        requireBroadcastSuccess: args.requireBroadcastSuccess,
      });
      return {
        message: `Certificate sign (${result.walletType}, signer${args.signerIndex}) status=${result.status} submitted=${String(result.submitted)}`,
        artifacts: result as unknown as Record<string, unknown>,
      };
    },
  };
}

/**
 * Builds the five steps for a single certificate action phase:
 *   1. Propose tx via bot cert endpoint
 *   2. Assert tx appears in pending
 *   3. Signer 1 adds witness (no broadcast)
 *   4. Signer 2 adds witness + broadcast
 *   5. Assert tx cleared from pending  (only when requireBroadcastSuccess=true)
 *
 * For staking cert (requireBroadcastSuccess=false): the staking certificate script
 * uses stake key hashes (role-2), while signTransaction validates witnesses against
 * the signer's payment key hash.  Payment-key witnesses satisfy the spending script
 * but cannot satisfy the separate stake-cert script, so broadcast will fail on-chain.
 * Step 5 is omitted in that case.  The test still validates that the API endpoint
 * creates the pending transaction and that both signers can add witnesses.
 */
function createCertPhaseSteps(args: {
  idPrefix: string;
  walletType: CIWalletType;
  certEndpoint: "botDRepCertificate" | "botStakeCertificate";
  action: string;
  label: string;
  runtime: { transactionId?: string; spentUtxoRefs?: { txHash: string; outputIndex: number }[] };
  requireBroadcastSuccess: boolean;
  buildExtraBody?: (ctx: CIBootstrapContext) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** When true, each signing step uses the stake-cert flow (payment + stake witnesses). */
  useStakeCertFlow?: boolean;
}): RouteStep[] {
  const { idPrefix, walletType, certEndpoint, action, label, runtime } = args;

  const steps: RouteStep[] = [
    // ── 1. Propose ───────────────────────────────────────────────────────────
    {
      id: `${idPrefix}.propose`,
      description: `Propose ${label}`,
      severity: "critical",
      execute: async (ctx) => {
        const wallet = ctx.wallets.find((w) => w.type === walletType);
        if (!wallet) {
          throw new Error(`Wallet type "${walletType}" not found in CI context`);
        }
        const bot = getDefaultBot(ctx);
        const token = await authenticateBot({ ctx, bot });
        const utxoRefs = await fetchUtxoRefs({
          ctx,
          walletId: wallet.walletId,
          token,
          botAddress: bot.paymentAddress,
          fresh: true,
        });

        const extraBody = args.buildExtraBody ? await args.buildExtraBody(ctx) : {};
        const body: Record<string, unknown> = {
          walletId: wallet.walletId,
          address: bot.paymentAddress,
          action,
          utxoRefs,
          description: label,
          ...extraBody,
        };

        const response = await requestJson<{ id?: string; error?: string }>({
          url: `${ctx.apiBaseUrl}/api/v1/${certEndpoint}`,
          method: "POST",
          token,
          body,
        });
        if (response.status !== 201 || !response.data?.id) {
          throw new Error(
            `${certEndpoint} (${action}) failed (${response.status}): ${stringifyRedacted(response.data)}`,
          );
        }
        runtime.transactionId = response.data.id;
        runtime.spentUtxoRefs = utxoRefs;
        return {
          message: `${label} tx created (${runtime.transactionId})`,
          artifacts: { walletId: wallet.walletId, transactionId: runtime.transactionId, action },
        };
      },
    },

    // ── 2. Assert pending ─────────────────────────────────────────────────────
    {
      id: `${idPrefix}.pending`,
      description: `Assert ${label} tx is pending`,
      severity: "critical",
      execute: async (ctx) => {
        const txId = runtime.transactionId;
        const wallet = ctx.wallets.find((w) => w.type === walletType);
        if (!txId || !wallet) {
          throw new Error(`Missing transaction id or wallet context for ${idPrefix}`);
        }
        const bot = getDefaultBot(ctx);
        const token = await authenticateBot({ ctx, bot });
        const response = await requestJson<Array<{ id?: string }> | { error?: string }>({
          url: `${ctx.apiBaseUrl}/api/v1/pendingTransactions?walletId=${encodeURIComponent(wallet.walletId)}&address=${encodeURIComponent(bot.paymentAddress)}`,
          method: "GET",
          token,
        });
        if (response.status !== 200 || !Array.isArray(response.data)) {
          throw new Error(
            `pendingTransactions check failed (${response.status}): ${stringifyRedacted(response.data)}`,
          );
        }
        if (!response.data.some((tx) => tx.id === txId)) {
          throw new Error(`Certificate tx ${txId} not found in pending transactions`);
        }
        return {
          message: `${label} tx ${txId} is pending`,
          artifacts: { transactionId: txId, pendingCount: response.data.length },
        };
      },
    },

    // ── 3. Signer 1 witness (no broadcast) ───────────────────────────────────
    createCertSigningStep({
      id: `${idPrefix}.sign.signer1`,
      description: `Signer 1 adds witness for ${label} (no broadcast)`,
      signerIndex: 1,
      mnemonicEnvName: "CI_MNEMONIC_2",
      walletType,
      signBroadcast: false,
      requireBroadcastSuccess: false,
      getTransactionId: () => runtime.transactionId,
      useStakeCertFlow: args.useStakeCertFlow,
    }),

    // ── 4. Signer 2 witness + broadcast ──────────────────────────────────────
    createCertSigningStep({
      id: `${idPrefix}.sign.signer2`,
      description: `Signer 2 signs and broadcasts ${label}`,
      signerIndex: 2,
      mnemonicEnvName: "CI_MNEMONIC_3",
      walletType,
      signBroadcast: true,
      requireBroadcastSuccess: args.requireBroadcastSuccess,
      getTransactionId: () => runtime.transactionId,
      useStakeCertFlow: args.useStakeCertFlow,
    }),
  ];

  // ── 5. Assert cleared (only when broadcast is required to succeed) ─────────
  if (args.requireBroadcastSuccess) {
    steps.push({
      id: `${idPrefix}.cleared`,
      description: `Assert ${label} tx is cleared after broadcast`,
      severity: "critical",
      execute: async (ctx) => {
        const txId = runtime.transactionId;
        const wallet = ctx.wallets.find((w) => w.type === walletType);
        if (!txId || !wallet) {
          throw new Error(`Missing transaction id or wallet context for ${idPrefix}`);
        }
        const bot = getDefaultBot(ctx);
        const token = await authenticateBot({ ctx, bot });
        const response = await requestJson<Array<{ id?: string }> | { error?: string }>({
          url: `${ctx.apiBaseUrl}/api/v1/pendingTransactions?walletId=${encodeURIComponent(wallet.walletId)}&address=${encodeURIComponent(bot.paymentAddress)}`,
          method: "GET",
          token,
        });
        if (response.status !== 200 || !Array.isArray(response.data)) {
          throw new Error(
            `pendingTransactions cleared check failed (${response.status}): ${stringifyRedacted(response.data)}`,
          );
        }
        if (response.data.some((tx) => tx.id === txId)) {
          throw new Error(`Certificate tx ${txId} is still pending after sign+broadcast`);
        }
        return {
          message: `${label} tx ${txId} cleared from pending`,
          artifacts: { transactionId: txId, pendingCount: response.data.length },
        };
      },
    });

    // ── 6. Wait for on-chain confirmation ─────────────────────────────────────
    // The next cert phase needs confirmed UTxOs. Poll freeUtxos?fresh=true until
    // the inputs spent by this tx are no longer visible (tx included in a block).
    steps.push({
      id: `${idPrefix}.onchain`,
      description: `Wait for ${label} tx inputs to be confirmed on-chain`,
      severity: "critical",
      execute: async (ctx) => {
        const wallet = ctx.wallets.find((w) => w.type === walletType);
        if (!wallet) {
          throw new Error(`Wallet type "${walletType}" not found in CI context`);
        }
        const spentRefs = runtime.spentUtxoRefs ?? [];
        if (spentRefs.length === 0) {
          return { message: "No spent UTxO refs recorded; skipping on-chain confirmation wait", artifacts: {} };
        }
        const bot = getDefaultBot(ctx);
        const token = await authenticateBot({ ctx, bot });
        const { attempts } = await pollUntilUtxosConsumed({
          ctx,
          walletId: wallet.walletId,
          token,
          botAddress: bot.paymentAddress,
          spentUtxoRefs: spentRefs,
        });
        return {
          message: `${label} inputs confirmed on-chain after ${attempts} poll attempt${attempts === 1 ? "" : "s"}`,
          artifacts: { spentCount: spentRefs.length, attempts },
        };
      },
    });
  }

  return steps;
}

/**
 * Pre-hygiene step for a single wallet type: checks on-chain DRep state via
 * GET /api/v1/drepInfo and deregisters if already registered, so the main
 * register phase starts from a known clean state.
 *
 * Handles stale Blockfrost cache gracefully — if the broadcast is rejected
 * with DRepNotRegistered or similar errors, the credential is confirmed clean
 * and the step succeeds silently.
 */
function createDRepHygieneStep(walletType: CIWalletType): RouteStep {
  return {
    id: `v1.botDRepCertificate.${walletType}.hygiene`,
    description: `Ensure ${walletType} DRep is deregistered before test`,
    severity: "critical",
    execute: async (ctx) => {
      const wallet = ctx.wallets.find((w) => w.type === walletType);
      if (!wallet) {
        throw new Error(`Wallet type "${walletType}" not found in CI context`);
      }

      const bot = getDefaultBot(ctx);
      const token = await authenticateBot({ ctx, bot });

      // Check on-chain DRep state.
      const checkResp = await requestJson<{ active?: boolean; dRepId?: string; error?: string }>({
        url: `${ctx.apiBaseUrl}/api/v1/drepInfo?walletId=${encodeURIComponent(wallet.walletId)}&address=${encodeURIComponent(bot.paymentAddress)}`,
        method: "GET",
        token,
      });
      if (checkResp.status !== 200) {
        throw new Error(`drepInfo failed (${checkResp.status}): ${stringifyRedacted(checkResp.data)}`);
      }
      if (!checkResp.data?.active) {
        return {
          message: `${walletType} DRep not registered on-chain; proceeding to main test`,
          artifacts: { walletId: wallet.walletId, active: false, dRepId: checkResp.data?.dRepId },
        };
      }

      // DRep is registered — retire it.
      const utxoRefs = await fetchUtxoRefs({
        ctx,
        walletId: wallet.walletId,
        token,
        botAddress: bot.paymentAddress,
        fresh: true,
      });

      const proposeResp = await requestJson<{ id?: string; error?: string }>({
        url: `${ctx.apiBaseUrl}/api/v1/botDRepCertificate`,
        method: "POST",
        token,
        body: {
          walletId: wallet.walletId,
          address: bot.paymentAddress,
          action: "retire",
          utxoRefs,
          description: "DRep retirement (hygiene)",
        },
      });
      if (proposeResp.status !== 201 || !proposeResp.data?.id) {
        throw new Error(`botDRepCertificate (hygiene retire) failed (${proposeResp.status}): ${stringifyRedacted(proposeResp.data)}`);
      }
      const txId = proposeResp.data.id;

      const mnemonic1 = process.env.CI_MNEMONIC_2;
      const mnemonic2 = process.env.CI_MNEMONIC_3;
      if (!mnemonic1?.trim()) throw new Error("CI_MNEMONIC_2 is required for hygiene signing");
      if (!mnemonic2?.trim()) throw new Error("CI_MNEMONIC_3 is required for hygiene signing");

      // Signer 1 — no broadcast.
      const sign1Result = await runSigningFlow({
        ctx,
        mnemonic: mnemonic1,
        signWalletType: walletType,
        signerIndex: 1,
        signerLabel: "signer1",
        signBroadcast: false,
        preferredTransactionId: txId,
        requireBroadcastSuccess: false,
      });
      console.log(`[drep-hygiene:${walletType}] signer1 sign: status=${sign1Result.status}`);

      // Signer 2 — broadcast. Catch stale-cache rejections: if Blockfrost reported the DRep
      // as active but it is not actually registered on-chain, the node rejects the retire cert.
      try {
        const sign2Result = await runSigningFlow({
          ctx,
          mnemonic: mnemonic2,
          signWalletType: walletType,
          signerIndex: 2,
          signerLabel: "signer2",
          signBroadcast: true,
          preferredTransactionId: txId,
          requireBroadcastSuccess: true,
        });
        console.log(`[drep-hygiene:${walletType}] signer2 sign: status=${sign2Result.status} submitted=${String(sign2Result.submitted)}`);
      } catch (err) {
        const errMsg = String(err);
        console.log(`[drep-hygiene:${walletType}] signer2 broadcast failed: ${errMsg.slice(0, 300)}`);
        const isStaleCache =
          errMsg.includes("DRepNotRegistered") ||
          errMsg.includes("DRepAlreadyRetired") ||
          errMsg.includes("VotingDRepsNotRegistered") ||
          errMsg.includes("ValueNotConservedUTxO") ||
          errMsg.includes("value is not balanced");
        if (isStaleCache) {
          return {
            message: `Hygiene DRep retire broadcast rejected — credential already deregistered (stale Blockfrost cache)`,
            artifacts: { walletId: wallet.walletId, txId, staleCache: true },
          };
        }
        throw err;
      }

      // Broadcast succeeded — wait for on-chain confirmation before the register phase.
      const { attempts } = await pollUntilUtxosConsumed({
        ctx,
        walletId: wallet.walletId,
        token,
        botAddress: bot.paymentAddress,
        spentUtxoRefs: utxoRefs,
      });
      return {
        message: `Hygiene DRep retire confirmed on-chain after ${attempts} poll attempt${attempts === 1 ? "" : "s"}`,
        artifacts: { walletId: wallet.walletId, txId, attempts },
      };
    },
  };
}

/**
 * DRep registration and retirement for legacy and SDK wallets.
 *
 * Legacy wallet:  payment script doubles as the DRep credential script, so
 *                 standard payment-key witnesses satisfy both spending inputs
 *                 and the DRep certificate → full sign + broadcast.
 *
 * SDK wallet:     the CI bootstrap sets signersDRepKeys = payment key hashes,
 *                 so the DRep certificate script also uses payment key hashes.
 *                 Standard payment-key witnesses satisfy both scripts
 *                 → full sign + broadcast.
 *
 * Pre-hygiene deregisters if already registered, then register then retire,
 * leaving the wallet in its pre-test DRep state.
 * Requires CI_DREP_ANCHOR_URL to be set.
 */
export function createScenarioDRepCertificates(): Scenario {
  const legacyReg: { transactionId?: string; spentUtxoRefs?: { txHash: string; outputIndex: number }[] } = {};
  const legacyRetire: { transactionId?: string; spentUtxoRefs?: { txHash: string; outputIndex: number }[] } = {};
  const sdkReg: { transactionId?: string; spentUtxoRefs?: { txHash: string; outputIndex: number }[] } = {};
  const sdkRetire: { transactionId?: string; spentUtxoRefs?: { txHash: string; outputIndex: number }[] } = {};

  async function buildDRepRegBody(): Promise<Record<string, unknown>> {
    const anchorUrl = process.env.CI_DREP_ANCHOR_URL?.trim();
    if (!anchorUrl) {
      throw new Error("CI_DREP_ANCHOR_URL is required for DRep registration");
    }
    const res = await fetch(anchorUrl);
    if (!res.ok) throw new Error(`Failed to fetch DRep anchor URL: HTTP ${res.status}`);
    const json = await res.json() as object;
    const anchorDataHash = hashDrepAnchor(json);
    return { anchorUrl, anchorDataHash };
  }

  return {
    id: "scenario.drep-certificates",
    description:
      "Register and retire DRep for legacy and SDK wallets, restoring pre-test state",
    steps: [
      // Legacy: hygiene (deregister if already registered)
      createDRepHygieneStep("legacy"),
      // Legacy: register
      ...createCertPhaseSteps({
        idPrefix: "v1.botDRepCertificate.legacy.register",
        walletType: "legacy",
        certEndpoint: "botDRepCertificate",
        action: "register",
        label: "DRep registration (legacy)",
        runtime: legacyReg,
        requireBroadcastSuccess: true,
        buildExtraBody: () => buildDRepRegBody(),
      }),
      // Legacy: retire
      ...createCertPhaseSteps({
        idPrefix: "v1.botDRepCertificate.legacy.retire",
        walletType: "legacy",
        certEndpoint: "botDRepCertificate",
        action: "retire",
        label: "DRep retirement (legacy)",
        runtime: legacyRetire,
        requireBroadcastSuccess: true,
      }),
      // SDK: hygiene (deregister if already registered)
      createDRepHygieneStep("sdk"),
      // SDK: register
      ...createCertPhaseSteps({
        idPrefix: "v1.botDRepCertificate.sdk.register",
        walletType: "sdk",
        certEndpoint: "botDRepCertificate",
        action: "register",
        label: "DRep registration (sdk)",
        runtime: sdkReg,
        requireBroadcastSuccess: true,
        buildExtraBody: () => buildDRepRegBody(),
      }),
      // SDK: retire
      ...createCertPhaseSteps({
        idPrefix: "v1.botDRepCertificate.sdk.retire",
        walletType: "sdk",
        certEndpoint: "botDRepCertificate",
        action: "retire",
        label: "DRep retirement (sdk)",
        runtime: sdkRetire,
        requireBroadcastSuccess: true,
      }),
    ],
  };
}

/**
 * Stake register_and_delegate then deregister for the SDK wallet.
 *
 * Uses register_and_delegate rather than bare register because the production
 * stakingCertificates.ts includes .certificateScript() on the register cert.
 * In Conway era a bare register cert with a script witness causes
 * ExtraneousScriptWitnessesUTXOW; register_and_delegate avoids this because
 * the delegate cert legitimately requires the same staking script.
 *
 * Pre-hygiene: a single self-contained step checks on-chain state via
 * stakeAccountInfo and deregisters if needed. It handles stale Blockfrost
 * cache gracefully — if the broadcast is rejected with StakeKeyNotRegisteredDELEG,
 * the credential is confirmed clean (the check was a false positive) and the
 * step succeeds. Because freeUtxos.ts no longer blocks UTxOs for rejected txs,
 * any failed deregister attempt does not block subsequent proposals.
 *
 * Requires ctx.stakePoolIdHex to be set (CI_STAKE_POOL_ID_HEX).
 */
export function createScenarioStakeCertificates(): Scenario {
  const registerAndDelegateRuntime: { transactionId?: string; spentUtxoRefs?: { txHash: string; outputIndex: number }[] } = {};
  const deregisterRuntime: { transactionId?: string; spentUtxoRefs?: { txHash: string; outputIndex: number }[] } = {};

  return {
    id: "scenario.stake-certificates",
    description:
      "Register-and-delegate then deregister staking for SDK wallet, restoring pre-test state",
    steps: [
      // ── Pre-hygiene: ensure credential is deregistered before test ─────────
      // Single self-contained step — handles Blockfrost stale-cache gracefully.
      {
        id: "v1.botStakeCertificate.sdk.hygiene",
        description: "Ensure SDK wallet stake credential is deregistered before test",
        severity: "critical",
        execute: async (ctx) => {
          const stakeAddress = ctx.sdkStakeAddress;
          if (!stakeAddress) {
            return {
              message: "sdkStakeAddress not in CI context; skipping hygiene",
              artifacts: { skipped: true },
            };
          }

          const bot = getDefaultBot(ctx);
          const token = await authenticateBot({ ctx, bot });

          // Check on-chain state via the app's stakeAccountInfo proxy.
          const checkResp = await requestJson<{ active?: boolean; error?: string }>({
            url: `${ctx.apiBaseUrl}/api/v1/stakeAccountInfo?stakeAddress=${encodeURIComponent(stakeAddress)}`,
            method: "GET",
            token,
          });
          if (checkResp.status !== 200) {
            throw new Error(`stakeAccountInfo failed (${checkResp.status}): ${stringifyRedacted(checkResp.data)}`);
          }
          if (!checkResp.data?.active) {
            return {
              message: "Stake credential not registered on-chain; proceeding to main test",
              artifacts: { stakeAddress, active: false },
            };
          }

          // Credential is registered — deregister it.
          const wallet = ctx.wallets.find((w) => w.type === "sdk");
          if (!wallet) throw new Error('SDK wallet not found in CI context');

          const utxoRefs = await fetchUtxoRefs({ ctx, walletId: wallet.walletId, token, botAddress: bot.paymentAddress, fresh: true });

          const proposeResp = await requestJson<{ id?: string; error?: string }>({
            url: `${ctx.apiBaseUrl}/api/v1/botStakeCertificate`,
            method: "POST",
            token,
            body: { walletId: wallet.walletId, address: bot.paymentAddress, action: "deregister", utxoRefs, description: "Stake deregistration (hygiene)" },
          });
          if (proposeResp.status !== 201 || !proposeResp.data?.id) {
            throw new Error(`botStakeCertificate (hygiene deregister) failed (${proposeResp.status}): ${stringifyRedacted(proposeResp.data)}`);
          }
          const txId = proposeResp.data.id;

          const mnemonic1 = process.env.CI_MNEMONIC_2;
          const mnemonic2 = process.env.CI_MNEMONIC_3;
          if (!mnemonic1?.trim()) throw new Error("CI_MNEMONIC_2 is required for hygiene signing");
          if (!mnemonic2?.trim()) throw new Error("CI_MNEMONIC_3 is required for hygiene signing");

          // Signer 1 — no broadcast (same as main test's deregister phase).
          const sign1Result = await runStakeCertSigningFlow({ ctx, mnemonic: mnemonic1, signerIndex: 1, signBroadcast: false, preferredTransactionId: txId, requireBroadcastSuccess: false });
          console.log(`[hygiene] signer1 sign: status=${sign1Result.status} stakeWitness=${String(sign1Result.stakeWitnessIncluded)}`);

          // Signer 2 — broadcast with requireBroadcastSuccess: true, matching the
          // main test's deregister phase. Catch stale-cache errors (the credential
          // was reported active by Blockfrost but is not actually registered on-chain:
          // StakeKeyNotRegisteredDELEG + ValueNotConservedUTxO from the missing 2 ADA
          // deposit refund) and treat them as "already clean".
          try {
            const sign2Result = await runStakeCertSigningFlow({ ctx, mnemonic: mnemonic2, signerIndex: 2, signBroadcast: true, preferredTransactionId: txId, requireBroadcastSuccess: true });
            console.log(`[hygiene] signer2 sign: status=${sign2Result.status} submitted=${String(sign2Result.submitted)} stakeWitness=${String(sign2Result.stakeWitnessIncluded)}`);
          } catch (err) {
            const errMsg = String(err);
            console.log(`[hygiene] signer2 broadcast failed: ${errMsg.slice(0, 300)}`);
            const isStaleCache =
              errMsg.includes("StakeKeyNotRegisteredDELEG") ||
              errMsg.includes("StakeKeyAlreadyDeregistered") ||
              errMsg.includes("StakeKeyNotRegistered") ||
              errMsg.includes("ValueNotConservedUTxO") ||
              errMsg.includes("value is not balanced");
            if (isStaleCache) {
              return {
                message: "Hygiene deregister broadcast rejected — credential already deregistered (stale Blockfrost cache)",
                artifacts: { stakeAddress, txId, staleCache: true },
              };
            }
            throw err;
          }

          // Broadcast succeeded — wait for on-chain confirmation.
          const { attempts } = await pollUntilUtxosConsumed({ ctx, walletId: wallet.walletId, token, botAddress: bot.paymentAddress, spentUtxoRefs: utxoRefs });
          return {
            message: `Hygiene deregister confirmed on-chain after ${attempts} poll attempt${attempts === 1 ? "" : "s"}`,
            artifacts: { stakeAddress, txId, attempts },
          };
        },
      },

      // ── Main test: register_and_delegate ─────────────────────────────────
      // Uses register_and_delegate so the staking script witness required by
      // the delegate cert prevents ExtraneousScriptWitnessesUTXOW on the
      // register cert. Requires ctx.stakePoolIdHex (CI_STAKE_POOL_ID_HEX).
      ...createCertPhaseSteps({
        idPrefix: "v1.botStakeCertificate.sdk.registerAndDelegate",
        walletType: "sdk",
        certEndpoint: "botStakeCertificate",
        action: "register_and_delegate",
        label: "Stake register-and-delegate (sdk)",
        runtime: registerAndDelegateRuntime,
        requireBroadcastSuccess: true,
        useStakeCertFlow: true,
        buildExtraBody: (ctx) => {
          if (!ctx.stakePoolIdHex) {
            throw new Error("ctx.stakePoolIdHex is required for register_and_delegate — set CI_STAKE_POOL_ID_HEX");
          }
          return { poolId: ctx.stakePoolIdHex };
        },
      }),

      // ── Main test: deregister (restore pre-test state) ────────────────────
      ...createCertPhaseSteps({
        idPrefix: "v1.botStakeCertificate.sdk.deregister",
        walletType: "sdk",
        certEndpoint: "botStakeCertificate",
        action: "deregister",
        label: "Stake deregistration (sdk)",
        runtime: deregisterRuntime,
        requireBroadcastSuccess: true,
        useStakeCertFlow: true,
      }),
    ],
  };
}
