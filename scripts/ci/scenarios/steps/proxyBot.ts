import type { CIBootstrapContext, CIWalletType, RouteStep, Scenario } from "../../framework/types";
import { boolFromEnv } from "../../framework/env";
import { requestJson } from "../../framework/http";
import { authenticateBot } from "../../framework/botAuth";
import { getDefaultBot } from "../../framework/botContext";
import { stringifyRedacted } from "../../framework/redact";
import { getDeterministicActiveProposals, type ActiveProposal } from "../../framework/governance";
import { runSigningFlow } from "../flows/signingFlow";
import { ensureProxyLifecycleUtxoShape } from "../flows/utxoShapeFlow";
import { recoverProxyRowsFromChainForWalletType } from "../proxyChainRecovery";
import { adoptProxyOrphansForWalletType } from "../proxyOrphanAdoption";
import { getWalletByType } from "./helpers";
import {
  assertProxyFullLifecyclePreflight,
  COLLATERAL_REQUIRED_LOVELACE,
  DREP_REGISTER_REQUIRED_LOVELACE,
  formatAda,
  FULL_LIFECYCLE_FEE_BUFFER_LOVELACE,
  key,
  LIFECYCLE_PROXY_LOVELACE,
  parseLovelace,
  PROXY_FULL_LIFECYCLE_WALLET_TYPES,
  PROXY_SPEND_LOVELACE,
  sameRef,
  SETUP_UTXO_REQUIRED_LOVELACE,
  toRef,
  type ScriptUtxo,
  type UtxoRef,
} from "../proxyLifecyclePreflight";

export {
  analyzeProxyFullLifecycleUtxoShape,
  assertProxyFullLifecyclePreflight,
  DREP_REGISTER_REQUIRED_LOVELACE,
  FULL_LIFECYCLE_FEE_BUFFER_LOVELACE,
  LIFECYCLE_PROXY_LOVELACE,
  PROXY_FULL_LIFECYCLE_WALLET_TYPES,
  type ProxyLifecycleUtxoShapeAnalysis,
  type ProxyLifecycleUtxoShapeStatus,
  type ScriptUtxo,
  type UtxoRef,
} from "../proxyLifecyclePreflight";

type ProxyRow = { id: string; proxyAddress: string; authTokenId: string; isActive?: boolean };
type ProxySetup = { proxyAddress: string; authTokenId: string; paramUtxo: UtxoRef };
type ProxyActionRequestRefs = { utxoRefs: UtxoRef[]; collateralRef: UtxoRef };
type ProxyActionSelection = ProxyActionRequestRefs & Record<string, unknown>;
type ProxyDRepInfoResponse = { active: boolean; dRepId: string; error?: string };
type ProxyLifecycleSignerIndex = 0 | 1 | 2;
type ProxyLifecycleMnemonicEnvName = "CI_MNEMONIC_1" | "CI_MNEMONIC_2" | "CI_MNEMONIC_3";

const PROXY_LIFECYCLE_COLLATERAL_SIGNER_INDEX = 0;
const PROXY_LIFECYCLE_SIGNER_INDEXES = [0, 1] as const;
export const PROXY_ACTION_REQUIRED_LOVELACE = 2_000_000n;
export const PROXY_ACTION_FEE_BUFFER_LOVELACE = 2_000_000n;

export function getProxyDRepAnchorUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const anchorUrl = env.CI_DREP_ANCHOR_URL?.trim();
  if (!anchorUrl) {
    throw new Error("CI_DREP_ANCHOR_URL is required for proxy DRep registration");
  }
  return anchorUrl;
}

function getTransactionId(data: unknown): string | undefined {
  if (typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>;
    if (typeof record.id === "string") return record.id;
    return getTransactionId(record.transaction);
  }
  return undefined;
}

function getSubmittedTxHash(data: unknown): string | undefined {
  if (typeof data === "string") return data;
  if (typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>;
    if (typeof record.txHash === "string") return record.txHash;
    return getSubmittedTxHash(record.transaction);
  }
  return undefined;
}

function getCleanupPhase(data: unknown): "sweep" | "burn" | undefined {
  if (typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>;
    const cleanup = record.cleanup;
    if (typeof cleanup === "object" && cleanup !== null) {
      const phase = (cleanup as Record<string, unknown>).phase;
      if (phase === "sweep" || phase === "burn") return phase;
    }
  }
  return undefined;
}

export function normalizeJsonArtifact(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalizeJsonArtifact);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, normalizeJsonArtifact(child)]),
    );
  }
  return value;
}

export function splitProxyActionSelection(selection: ProxyActionSelection): {
  requestRefs: ProxyActionRequestRefs;
  selectionArtifacts: Record<string, unknown>;
} {
  const { utxoRefs, collateralRef, ...selectionArtifacts } = selection;
  return {
    requestRefs: { utxoRefs, collateralRef },
    selectionArtifacts: normalizeJsonArtifact(selectionArtifacts) as Record<string, unknown>,
  };
}

export function shouldSkipCleanupBurnPropose(runtime: {
  cleanupPhase?: "sweep" | "burn";
  cleanupBurnTransactionId?: string;
}): boolean {
  return runtime.cleanupPhase === "burn" && !runtime.cleanupBurnTransactionId;
}

export function shouldSkipCleanupBurnSigning(runtime: {
  cleanupBurnSkipped?: boolean;
  cleanupBurnTransactionId?: string;
}): boolean {
  return runtime.cleanupBurnSkipped === true || !runtime.cleanupBurnTransactionId;
}

export function shouldSkipActionConfirmation(runtime: {
  actionTransactionId?: string;
  actionUtxoRefs?: UtxoRef[];
}): boolean {
  return !runtime.actionTransactionId || !runtime.actionUtxoRefs?.length;
}

async function fetchFreeUtxos(args: {
  ctx: CIBootstrapContext;
  walletId: string;
  token: string;
  address: string;
  fresh?: boolean;
}): Promise<ScriptUtxo[]> {
  const fresh = args.fresh ? "&fresh=true" : "";
  const response = await requestJson<ScriptUtxo[] | { error?: string }>({
    url: `${args.ctx.apiBaseUrl}/api/v1/freeUtxos?walletId=${encodeURIComponent(args.walletId)}&address=${encodeURIComponent(args.address)}${fresh}`,
    method: "GET",
    token: args.token,
  });
  if (response.status !== 200 || !Array.isArray(response.data)) {
    throw new Error(`freeUtxos failed (${response.status}): ${stringifyRedacted(response.data)}`);
  }
  return response.data;
}

async function fetchKeyAddressUtxos(args: {
  ctx: CIBootstrapContext;
  address: string;
}): Promise<ScriptUtxo[]> {
  const apiKey = process.env.CI_BLOCKFROST_PREPROD_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("CI_BLOCKFROST_PREPROD_API_KEY is required to fetch proxy lifecycle key-address collateral");
  }
  if (args.ctx.networkId !== 0) {
    throw new Error(`Proxy lifecycle key collateral lookup is preprod-only. Expected networkId=0, received networkId=${args.ctx.networkId}`);
  }

  const { BlockfrostProvider } = await import("@meshsdk/core");
  const provider = new BlockfrostProvider(apiKey);
  const utxos = await provider.fetchAddressUTxOs(args.address);
  return utxos.map((utxo) => ({
    input: utxo.input,
    output: utxo.output,
  }));
}

function isAdaOnlyCollateral(utxo: ScriptUtxo): boolean {
  return (
    parseLovelace(utxo) >= COLLATERAL_REQUIRED_LOVELACE &&
    utxo.output.amount.every((asset) => asset.unit === "lovelace")
  );
}

function selectSeparateCollateral(
  utxos: ScriptUtxo[],
  context: string,
): ScriptUtxo {
  const collateral = [...utxos]
    .filter(isAdaOnlyCollateral)
    .sort((left, right) => {
      const leftLovelace = parseLovelace(left);
      const rightLovelace = parseLovelace(right);
      if (leftLovelace < rightLovelace) return -1;
      if (leftLovelace > rightLovelace) return 1;
      return 0;
    })[0];
  if (!collateral) {
    throw new Error(
      `${context} requires an ADA-only bot payment-address collateral UTxO with at least ${formatAda(COLLATERAL_REQUIRED_LOVELACE)}`,
    );
  }
  return collateral;
}

export function selectSetupRefs(args: {
  walletUtxos: ScriptUtxo[];
  collateralUtxos: ScriptUtxo[];
}): { utxoRefs: UtxoRef[]; collateralRef: UtxoRef } {
  const setupUtxo = args.walletUtxos.find((utxo) => parseLovelace(utxo) >= SETUP_UTXO_REQUIRED_LOVELACE);
  if (!setupUtxo) {
    throw new Error(`proxy setup requires a wallet UTxO with at least ${formatAda(SETUP_UTXO_REQUIRED_LOVELACE)}`);
  }
  const setupRef = toRef(setupUtxo);
  const collateral = selectSeparateCollateral(args.collateralUtxos, "proxy setup");
  return { utxoRefs: [setupRef], collateralRef: toRef(collateral) };
}

export function selectAuthTokenRefs(args: {
  walletUtxos: ScriptUtxo[];
  collateralUtxos: ScriptUtxo[];
  authTokenId: string;
  includeAllAuthTokens?: boolean;
}): { utxoRefs: UtxoRef[]; collateralRef: UtxoRef } {
  const authTokenUtxos = args.walletUtxos.filter((utxo) =>
    utxo.output.amount.some((asset) => asset.unit === args.authTokenId && BigInt(asset.quantity) > 0n),
  );
  if (!authTokenUtxos.length) {
    throw new Error("No proxy auth-token UTxO found in freeUtxos response");
  }
  const spendUtxos = args.includeAllAuthTokens ? authTokenUtxos : [authTokenUtxos[0]!];
  const refs = spendUtxos.map(toRef);
  const collateral = selectSeparateCollateral(args.collateralUtxos, "proxy action");
  return { utxoRefs: refs, collateralRef: toRef(collateral) };
}

export function selectDRepRegisterRefs(args: {
  walletUtxos: ScriptUtxo[];
  collateralUtxos: ScriptUtxo[];
  authTokenId: string;
  requiredLovelace?: bigint;
}): { utxoRefs: UtxoRef[]; collateralRef: UtxoRef; selectedLovelace: bigint; requiredLovelace: bigint } {
  const requiredLovelace = args.requiredLovelace ?? DREP_REGISTER_REQUIRED_LOVELACE;
  const authTokenUtxo = args.walletUtxos.find((utxo) =>
    utxo.output.amount.some((asset) => asset.unit === args.authTokenId && BigInt(asset.quantity) > 0n),
  );
  if (!authTokenUtxo) {
    throw new Error("No proxy auth-token UTxO found in freeUtxos response");
  }

  const authRef = toRef(authTokenUtxo);
  const collateral = selectSeparateCollateral(args.collateralUtxos, "proxy DRep register");
  const collateralRef = toRef(collateral);
  const selectedRefs = [authRef];
  let selectedLovelace = parseLovelace(authTokenUtxo);
  const fundingCandidates = [...args.walletUtxos]
    .filter((utxo) => {
      const ref = toRef(utxo);
      return !sameRef(ref, authRef);
    })
    .sort((left, right) => {
      const leftLovelace = parseLovelace(left);
      const rightLovelace = parseLovelace(right);
      if (leftLovelace > rightLovelace) return -1;
      if (leftLovelace < rightLovelace) return 1;
      return 0;
    });

  for (const utxo of fundingCandidates) {
    if (selectedLovelace >= requiredLovelace) break;
    selectedRefs.push(toRef(utxo));
    selectedLovelace += parseLovelace(utxo);
  }

  if (selectedLovelace < requiredLovelace) {
    throw new Error(
      `proxy DRep register requires ${formatAda(requiredLovelace)} in selected wallet inputs but only ${formatAda(selectedLovelace)} is available after reserving separate collateral. Fund or consolidate the CI wallet before running scenario.proxy-full-lifecycle.`,
    );
  }

  return {
    utxoRefs: selectedRefs,
    collateralRef,
    selectedLovelace,
    requiredLovelace,
  };
}

export function selectAuthTokenRefsWithMinLovelace(args: {
  walletUtxos: ScriptUtxo[];
  collateralUtxos: ScriptUtxo[];
  authTokenId: string;
  requiredLovelace: bigint;
  context: string;
}): { utxoRefs: UtxoRef[]; collateralRef: UtxoRef; selectedLovelace: bigint; requiredLovelace: bigint } {
  const authTokenUtxo = args.walletUtxos.find((utxo) =>
    utxo.output.amount.some((asset) => asset.unit === args.authTokenId && BigInt(asset.quantity) > 0n),
  );
  if (!authTokenUtxo) {
    throw new Error("No proxy auth-token UTxO found in freeUtxos response");
  }

  const authRef = toRef(authTokenUtxo);
  const collateral = selectSeparateCollateral(args.collateralUtxos, args.context);
  const collateralRef = toRef(collateral);
  const selectedRefs = [authRef];
  let selectedLovelace = parseLovelace(authTokenUtxo);
  const fundingCandidates = [...args.walletUtxos]
    .filter((utxo) => {
      const ref = toRef(utxo);
      return !sameRef(ref, authRef);
    })
    .sort((left, right) => {
      const leftLovelace = parseLovelace(left);
      const rightLovelace = parseLovelace(right);
      if (leftLovelace > rightLovelace) return -1;
      if (leftLovelace < rightLovelace) return 1;
      return 0;
    });

  for (const utxo of fundingCandidates) {
    if (selectedLovelace >= args.requiredLovelace) break;
    selectedRefs.push(toRef(utxo));
    selectedLovelace += parseLovelace(utxo);
  }

  if (selectedLovelace < args.requiredLovelace) {
    throw new Error(
      `${args.context} requires ${formatAda(args.requiredLovelace)} in selected wallet inputs but only ${formatAda(selectedLovelace)} is available after reserving separate collateral. Fund or consolidate the CI wallet before running scenario.proxy-full-lifecycle.`,
    );
  }

  return {
    utxoRefs: selectedRefs,
    collateralRef,
    selectedLovelace,
    requiredLovelace: args.requiredLovelace,
  };
}

async function pollUntilUtxosConsumed(args: {
  ctx: CIBootstrapContext;
  walletId: string;
  token: string;
  address: string;
  spentUtxoRefs: UtxoRef[];
  maxRetries?: number;
  retryDelayMs?: number;
}): Promise<{ attempts: number }> {
  const maxRetries = args.maxRetries ?? 30;
  const retryDelayMs = args.retryDelayMs ?? 8000;
  const spent = new Set(args.spentUtxoRefs.map(key));
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
    }
    const utxos = await fetchFreeUtxos({ ...args, fresh: true });
    if (!utxos.some((utxo) => spent.has(key(toRef(utxo))))) {
      return { attempts: attempt + 1 };
    }
  }
  throw new Error(`Timed out waiting for proxy transaction inputs to be confirmed`);
}

type ProxyLifecycleHygieneDeps = {
  requestJson: typeof requestJson;
  authenticateBot: typeof authenticateBot;
  getDefaultBot: typeof getDefaultBot;
  fetchFreeUtxos: typeof fetchFreeUtxos;
  fetchKeyAddressUtxos: typeof fetchKeyAddressUtxos;
  runSigningFlow: typeof runSigningFlow;
  pollUntilUtxosConsumed: typeof pollUntilUtxosConsumed;
  env: Record<string, string | undefined>;
};

const defaultProxyLifecycleHygieneDeps: ProxyLifecycleHygieneDeps = {
  requestJson,
  authenticateBot,
  getDefaultBot,
  fetchFreeUtxos,
  fetchKeyAddressUtxos,
  runSigningFlow,
  pollUntilUtxosConsumed,
  env: process.env,
};

async function listActiveProxies(args: {
  ctx: CIBootstrapContext;
  walletId: string;
  address: string;
  token: string;
  requestJsonFn: typeof requestJson;
}): Promise<ProxyRow[]> {
  const response = await args.requestJsonFn<ProxyRow[] | { error?: string }>({
    url: `${args.ctx.apiBaseUrl}/api/v1/proxies?walletId=${encodeURIComponent(args.walletId)}&address=${encodeURIComponent(args.address)}`,
    method: "GET",
    token: args.token,
  });
  if (response.status !== 200 || !Array.isArray(response.data)) {
    throw new Error(`proxies list failed (${response.status}): ${stringifyRedacted(response.data)}`);
  }
  return response.data;
}

async function fetchProxyDRepInfo(args: {
  ctx: CIBootstrapContext;
  walletId: string;
  address: string;
  proxyId: string;
  token: string;
  requestJsonFn: typeof requestJson;
}): Promise<ProxyDRepInfoResponse> {
  const response = await args.requestJsonFn<ProxyDRepInfoResponse>({
    url: `${args.ctx.apiBaseUrl}/api/v1/proxyDRepInfo?walletId=${encodeURIComponent(args.walletId)}&address=${encodeURIComponent(args.address)}&proxyId=${encodeURIComponent(args.proxyId)}`,
    method: "GET",
    token: args.token,
  });
  if (response.status !== 200 || typeof response.data?.active !== "boolean" || typeof response.data?.dRepId !== "string") {
    throw new Error(`proxyDRepInfo failed (${response.status}): ${stringifyRedacted(response.data)}`);
  }
  return response.data;
}

export async function runProxyFullLifecycleHygiene(args: {
  ctx: CIBootstrapContext;
  walletType: CIWalletType;
  deps?: Partial<ProxyLifecycleHygieneDeps>;
}): Promise<{ message: string; artifacts: Record<string, unknown> }> {
  const deps = { ...defaultProxyLifecycleHygieneDeps, ...args.deps };
  const wallet = getWalletByType(args.ctx, args.walletType);
  if (!wallet) throw new Error(`Missing ${args.walletType} wallet`);
  const bot = deps.getDefaultBot(args.ctx);
  const token = await deps.authenticateBot({ ctx: args.ctx, bot });
  const initialProxies = await listActiveProxies({
    ctx: args.ctx,
    walletId: wallet.walletId,
    address: bot.paymentAddress,
    token,
    requestJsonFn: deps.requestJson,
  });

  if (!initialProxies.length) {
    return {
      message: `proxy full lifecycle hygiene found no active proxies for ${args.walletType}`,
      artifacts: { walletId: wallet.walletId, cleaned: [], noOp: true },
    };
  }

  const cleaned: Record<string, unknown>[] = [];
  const signer0Mnemonic = deps.env.CI_MNEMONIC_1;
  const signer1Mnemonic = deps.env.CI_MNEMONIC_2;
  if (!signer0Mnemonic?.trim()) throw new Error("CI_MNEMONIC_1 is required for proxy lifecycle hygiene signing");
  if (!signer1Mnemonic?.trim()) throw new Error("CI_MNEMONIC_2 is required for proxy lifecycle hygiene signing");

  for (const proxy of initialProxies) {
    let finalTxHash: string | undefined;
    let finalTransactionId: string | undefined;
    let finalPhase: "sweep" | "burn" | undefined;
    const cleanupTransactions: Record<string, unknown>[] = [];
    let dRepDeregisterTransaction: Record<string, unknown> | undefined;

    const dRepInfo = await fetchProxyDRepInfo({
      ctx: args.ctx,
      walletId: wallet.walletId,
      address: bot.paymentAddress,
      proxyId: proxy.id,
      token,
      requestJsonFn: deps.requestJson,
    });
    if (dRepInfo.active) {
      const [walletUtxos, collateralUtxos] = await Promise.all([
        deps.fetchFreeUtxos({
          ctx: args.ctx,
          walletId: wallet.walletId,
          token,
          address: bot.paymentAddress,
          fresh: true,
        }),
        deps.fetchKeyAddressUtxos({ ctx: args.ctx, address: bot.paymentAddress }),
      ]);
      const selection = selectAuthTokenRefsWithMinLovelace({
        walletUtxos,
        collateralUtxos,
        authTokenId: proxy.authTokenId,
        requiredLovelace: PROXY_ACTION_REQUIRED_LOVELACE + PROXY_ACTION_FEE_BUFFER_LOVELACE,
        context: "proxy hygiene DRep deregister",
      });
      const { requestRefs, selectionArtifacts } = splitProxyActionSelection(selection);
      const response = await deps.requestJson<unknown | { error?: string }>({
        url: `${args.ctx.apiBaseUrl}/api/v1/proxyDRepCertificate`,
        method: "POST",
        token,
        body: {
          walletId: wallet.walletId,
          address: bot.paymentAddress,
          proxyId: proxy.id,
          ...requestRefs,
          action: "deregister",
          description: `CI proxy full lifecycle hygiene DRep deregister (${args.walletType})`,
        },
      });
      if (response.status !== 201) {
        throw new Error(`proxyDRepCertificate hygiene failed (${response.status}): ${stringifyRedacted(response.data)}`);
      }

      const txId = getTransactionId(response.data);
      if (!txId) {
        throw new Error(`proxyDRepCertificate hygiene response did not include a transaction id: ${stringifyRedacted(response.data)}`);
      }
      let txHash = getSubmittedTxHash(response.data);

      const signer0Result = await deps.runSigningFlow({
        ctx: args.ctx,
        mnemonic: signer0Mnemonic,
        signWalletType: args.walletType,
        signerIndex: 0,
        signBroadcast: false,
        preferredTransactionId: txId,
        requireBroadcastSuccess: false,
      });
      const signer1Result = await deps.runSigningFlow({
        ctx: args.ctx,
        mnemonic: signer1Mnemonic,
        signWalletType: args.walletType,
        signerIndex: 1,
        signBroadcast: true,
        preferredTransactionId: txId,
        requireBroadcastSuccess: true,
      });
      txHash = signer1Result.txHash ?? txHash;

      const confirmation = await deps.pollUntilUtxosConsumed({
        ctx: args.ctx,
        walletId: wallet.walletId,
        token,
        address: bot.paymentAddress,
        spentUtxoRefs: requestRefs.utxoRefs,
      });
      dRepDeregisterTransaction = {
        dRepId: dRepInfo.dRepId,
        transactionId: txId,
        txHash,
        selectedUtxoRefs: requestRefs.utxoRefs,
        selectionArtifacts,
        confirmationAttempts: confirmation.attempts,
        signer0Status: signer0Result.status,
        signer1Status: signer1Result.status,
      };
    }

    for (let pass = 0; pass < 2; pass += 1) {
      const [walletUtxos, collateralUtxos] = await Promise.all([
        deps.fetchFreeUtxos({
          ctx: args.ctx,
          walletId: wallet.walletId,
          token,
          address: bot.paymentAddress,
          fresh: true,
        }),
        deps.fetchKeyAddressUtxos({ ctx: args.ctx, address: bot.paymentAddress }),
      ]);
      const selection = selectAuthTokenRefs({
        walletUtxos,
        collateralUtxos,
        authTokenId: proxy.authTokenId,
        includeAllAuthTokens: true,
      });
      const response = await deps.requestJson<unknown | { error?: string }>({
        url: `${args.ctx.apiBaseUrl}/api/v1/proxyCleanup`,
        method: "POST",
        token,
        body: {
          walletId: wallet.walletId,
          address: bot.paymentAddress,
          proxyId: proxy.id,
          ...selection,
          deactivateProxy: true,
          description: `CI proxy full lifecycle hygiene (${args.walletType})`,
        },
      });
      if (response.status !== 201) {
        throw new Error(`proxyCleanup hygiene failed (${response.status}): ${stringifyRedacted(response.data)}`);
      }

      const txId = getTransactionId(response.data);
      if (!txId) {
        throw new Error(`proxyCleanup hygiene response did not include a transaction id: ${stringifyRedacted(response.data)}`);
      }
      finalTransactionId = txId;
      finalTxHash = getSubmittedTxHash(response.data);
      finalPhase = getCleanupPhase(response.data);

      const signer0Result = await deps.runSigningFlow({
        ctx: args.ctx,
        mnemonic: signer0Mnemonic,
        signWalletType: args.walletType,
        signerIndex: 0,
        signBroadcast: false,
        preferredTransactionId: txId,
        requireBroadcastSuccess: false,
      });
      const signer1Result = await deps.runSigningFlow({
        ctx: args.ctx,
        mnemonic: signer1Mnemonic,
        signWalletType: args.walletType,
        signerIndex: 1,
        signBroadcast: true,
        preferredTransactionId: txId,
        requireBroadcastSuccess: true,
      });
      finalTxHash = signer1Result.txHash ?? finalTxHash;

      const confirmation = await deps.pollUntilUtxosConsumed({
        ctx: args.ctx,
        walletId: wallet.walletId,
        token,
        address: bot.paymentAddress,
        spentUtxoRefs: selection.utxoRefs,
      });
      cleanupTransactions.push({
        phase: finalPhase,
        transactionId: txId,
        txHash: finalTxHash,
        selectedUtxoRefs: selection.utxoRefs,
        confirmationAttempts: confirmation.attempts,
        signer0Status: signer0Result.status,
        signer1Status: signer1Result.status,
      });

      if (finalPhase === "burn") break;
    }

    if (finalPhase !== "burn") {
      throw new Error(`proxy hygiene could not reach burn phase for active proxy ${proxy.id}`);
    }

    const finalizeResponse = await deps.requestJson<{ proxy?: ProxyRow; error?: string }>({
      url: `${args.ctx.apiBaseUrl}/api/v1/proxyCleanupFinalize`,
      method: "POST",
      token,
      body: {
        walletId: wallet.walletId,
        address: bot.paymentAddress,
        proxyId: proxy.id,
        txHash: finalTxHash ?? finalTransactionId ?? "submitted",
      },
      retries: 3,
    });
    if (finalizeResponse.status !== 201 || finalizeResponse.data?.proxy?.isActive !== false) {
      throw new Error(`proxyCleanupFinalize hygiene failed (${finalizeResponse.status}): ${stringifyRedacted(finalizeResponse.data)}`);
    }

    const remainingProxies = await listActiveProxies({
      ctx: args.ctx,
      walletId: wallet.walletId,
      address: bot.paymentAddress,
      token,
      requestJsonFn: deps.requestJson,
    });
    if (remainingProxies.some((candidate) => candidate.id === proxy.id)) {
      throw new Error(`hygiene-cleaned proxy ${proxy.id} is still listed as active`);
    }

    cleaned.push({
      proxyId: proxy.id,
      authTokenId: proxy.authTokenId,
      proxyAddress: proxy.proxyAddress,
      dRep: {
        dRepId: dRepInfo.dRepId,
        wasActive: dRepInfo.active,
        deregisterTransaction: dRepDeregisterTransaction,
      },
      finalTxHash,
      cleanupTransactions,
    });
  }

  return {
    message: `proxy full lifecycle hygiene cleaned ${cleaned.length} active proxy/proxies for ${args.walletType}`,
    artifacts: normalizeJsonArtifact({ walletId: wallet.walletId, cleaned, noOp: false }) as Record<string, unknown>,
  };
}

function createExpectedStatusStep(args: {
  id: string;
  description: string;
  method: "GET" | "POST";
  url: (ctx: CIBootstrapContext) => string;
  token?: (ctx: CIBootstrapContext) => Promise<string | undefined>;
  body?: (ctx: CIBootstrapContext) => Record<string, unknown>;
  expectedStatus: number;
  validate?: (data: unknown) => void;
}): RouteStep {
  return {
    id: args.id,
    description: args.description,
    severity: "critical",
    execute: async (ctx) => {
      const token = args.token ? await args.token(ctx) : undefined;
      const response = await requestJson<{ error?: string }>({
        url: args.url(ctx),
        method: args.method,
        token,
        body: args.body?.(ctx),
      });
      if (response.status !== args.expectedStatus) {
        throw new Error(
          `${args.id} expected ${args.expectedStatus}, got ${response.status}: ${stringifyRedacted(response.data)}`,
        );
      }
      args.validate?.(response.data);
      return { message: `${args.id} returned expected ${args.expectedStatus}` };
    },
  };
}

export function createScenarioProxySmoke(ctx: CIBootstrapContext): Scenario {
  return {
    id: "scenario.proxy-smoke",
    description: "Proxy bot API smoke and negative validation checks",
    steps: [
      ...ctx.walletTypes.map((walletType) => {
        const wallet = getWalletByType(ctx, walletType);
        return createExpectedStatusStep({
          id: `v1.proxies.missingToken.${walletType}`,
          description: `Assert /api/v1/proxies rejects missing token (${walletType})`,
          method: "GET",
          url: (runCtx) => {
            const target = wallet ?? getWalletByType(runCtx, walletType);
            if (!target) throw new Error(`Missing ${walletType} wallet`);
            const address = target.signerAddresses[0] ?? runCtx.signerAddresses[0] ?? "";
            return `${runCtx.apiBaseUrl}/api/v1/proxies?walletId=${encodeURIComponent(target.walletId)}&address=${encodeURIComponent(address)}`;
          },
          expectedStatus: 401,
        });
      }),
      ...ctx.walletTypes.map((walletType) =>
        createExpectedStatusStep({
          id: `v1.proxies.list.${walletType}`,
          description: `Assert /api/v1/proxies returns active proxy list (${walletType})`,
          method: "GET",
          token: async (runCtx) => authenticateBot({ ctx: runCtx, bot: getDefaultBot(runCtx) }),
          url: (runCtx) => {
            const wallet = getWalletByType(runCtx, walletType);
            if (!wallet) throw new Error(`Missing ${walletType} wallet`);
            const bot = getDefaultBot(runCtx);
            return `${runCtx.apiBaseUrl}/api/v1/proxies?walletId=${encodeURIComponent(wallet.walletId)}&address=${encodeURIComponent(bot.paymentAddress)}`;
          },
          expectedStatus: 200,
          validate: (data) => {
            if (!Array.isArray(data)) {
              throw new Error(`v1.proxies.list.${walletType} expected array response: ${stringifyRedacted(data)}`);
            }
          },
        }),
      ),
      ...ctx.walletTypes.map((walletType) =>
        createExpectedStatusStep({
          id: `v1.proxies.addressMismatch.${walletType}`,
          description: `Assert /api/v1/proxies rejects address mismatch (${walletType})`,
          method: "GET",
          token: async (runCtx) => authenticateBot({ ctx: runCtx, bot: getDefaultBot(runCtx) }),
          url: (runCtx) => {
            const wallet = getWalletByType(runCtx, walletType);
            if (!wallet) throw new Error(`Missing ${walletType} wallet`);
            const bot = getDefaultBot(runCtx);
            const mismatch = runCtx.bots.find((candidate) => candidate.id !== bot.id)?.paymentAddress ?? `${bot.paymentAddress}x`;
            return `${runCtx.apiBaseUrl}/api/v1/proxies?walletId=${encodeURIComponent(wallet.walletId)}&address=${encodeURIComponent(mismatch)}`;
          },
          expectedStatus: 403,
        }),
      ),
      ...[
        "proxySetup",
        "proxySetupFinalize",
        "proxySpend",
        "proxyDRepCertificate",
        "proxyVote",
        "proxyCleanup",
        "proxyCleanupFinalize",
      ].map((route) =>
        createExpectedStatusStep({
          id: `v1.${route}.malformedBody`,
          description: `Assert /api/v1/${route} rejects malformed body before chain work`,
          method: "POST",
          token: async (runCtx) => authenticateBot({ ctx: runCtx, bot: getDefaultBot(runCtx) }),
          url: (runCtx) => `${runCtx.apiBaseUrl}/api/v1/${route}`,
          body: (runCtx) => ({
            walletId: runCtx.wallets[0]?.walletId ?? "missing-wallet",
            address: getDefaultBot(runCtx).paymentAddress,
            ...(route === "proxySetup" ? { initialProxyLovelace: "0" } : {}),
          }),
          expectedStatus: 400,
        }),
      ),
    ],
  };
}

function createSignStep(args: {
  id: string;
  description: string;
  walletType: CIWalletType;
  signerIndex: ProxyLifecycleSignerIndex;
  mnemonicEnvName: ProxyLifecycleMnemonicEnvName;
  signBroadcast: boolean;
  getTransactionId: () => string | undefined;
  setTxHash?: (txHash: string | undefined) => void;
  shouldSkip?: () => boolean;
}): RouteStep {
  return {
    id: args.id,
    description: args.description,
    severity: "critical",
    execute: async (ctx) => {
      if (args.shouldSkip?.()) {
        return { message: "Signing skipped", artifacts: { skipped: true } };
      }
      const txId = args.getTransactionId();
      if (!txId) {
        return { message: "No pending transaction id; signing skipped", artifacts: { skipped: true } };
      }
      const mnemonic = process.env[args.mnemonicEnvName];
      if (!mnemonic?.trim()) {
        throw new Error(`${args.mnemonicEnvName} is required for proxy lifecycle signing`);
      }
      const result = await runSigningFlow({
        ctx,
        mnemonic,
        signWalletType: args.walletType,
        signerIndex: args.signerIndex,
        signBroadcast: args.signBroadcast && boolFromEnv(process.env.SIGN_BROADCAST, true),
        preferredTransactionId: txId,
        requireBroadcastSuccess: args.signBroadcast,
      });
      args.setTxHash?.(result.txHash);
      return {
        message: `Proxy lifecycle sign signerIndex=${args.signerIndex} status=${result.status} submitted=${String(result.submitted)}`,
        artifacts: result as unknown as Record<string, unknown>,
      };
    },
  };
}

function createSetupLifecycleSteps(args: {
  walletType: CIWalletType;
  runtime: {
    setup?: ProxySetup;
    proxyId?: string;
    setupTransactionId?: string;
    setupTxHash?: string;
    setupUtxoRefs?: UtxoRef[];
  };
}): RouteStep[] {
  const { walletType, runtime } = args;
  return [
    {
      id: `v1.proxy.lifecycle.setup.propose.${walletType}`,
      description: `Build proxy setup transaction (${walletType})`,
      severity: "critical",
      execute: async (ctx) => {
        const wallet = getWalletByType(ctx, walletType);
        if (!wallet) throw new Error(`Missing ${walletType} wallet`);
        const bot = getDefaultBot(ctx);
        const token = await authenticateBot({ ctx, bot });
        const [walletUtxos, collateralUtxos] = await Promise.all([
          fetchFreeUtxos({ ctx, walletId: wallet.walletId, token, address: bot.paymentAddress, fresh: true }),
          fetchKeyAddressUtxos({ ctx, address: bot.paymentAddress }),
        ]);
        const refs = selectSetupRefs({ walletUtxos, collateralUtxos });
        const response = await requestJson<{ transaction?: unknown; setup?: ProxySetup; error?: string }>({
          url: `${ctx.apiBaseUrl}/api/v1/proxySetup`,
          method: "POST",
          token,
          body: {
            walletId: wallet.walletId,
            address: bot.paymentAddress,
            ...refs,
            initialProxyLovelace: LIFECYCLE_PROXY_LOVELACE.toString(),
            description: `CI proxy setup (${walletType})`,
          },
        });
        if (response.status !== 201 || !response.data?.setup) {
          throw new Error(`proxySetup failed (${response.status}): ${stringifyRedacted(response.data)}`);
        }
        runtime.setup = response.data.setup;
        runtime.setupUtxoRefs = refs.utxoRefs;
        runtime.setupTransactionId = getTransactionId(response.data);
        runtime.setupTxHash = getSubmittedTxHash(response.data);
        return {
          message: `proxySetup created setup for ${walletType}`,
          artifacts: {
            walletId: wallet.walletId,
            setup: runtime.setup,
            transactionId: runtime.setupTransactionId,
            txHash: runtime.setupTxHash,
            collateralRef: refs.collateralRef,
            collateralOwnerSignerIndex: PROXY_LIFECYCLE_COLLATERAL_SIGNER_INDEX,
            signerIndexes: [...PROXY_LIFECYCLE_SIGNER_INDEXES],
          },
        };
      },
    },
    createSignStep({
      id: `v1.proxy.lifecycle.setup.signer0.${walletType}`,
      description: `Signer index 0 adds collateral witness for proxy setup (${walletType})`,
      walletType,
      signerIndex: 0,
      mnemonicEnvName: "CI_MNEMONIC_1",
      signBroadcast: false,
      getTransactionId: () => runtime.setupTransactionId,
    }),
    createSignStep({
      id: `v1.proxy.lifecycle.setup.signer1.${walletType}`,
      description: `Signer index 1 broadcasts proxy setup (${walletType})`,
      walletType,
      signerIndex: 1,
      mnemonicEnvName: "CI_MNEMONIC_2",
      signBroadcast: true,
      getTransactionId: () => runtime.setupTransactionId,
      setTxHash: (txHash) => {
        runtime.setupTxHash = txHash ?? runtime.setupTxHash;
      },
    }),
    {
      id: `v1.proxy.lifecycle.setup.finalize.${walletType}`,
      description: `Finalize confirmed proxy setup (${walletType})`,
      severity: "critical",
      execute: async (ctx) => {
        const wallet = getWalletByType(ctx, walletType);
        if (!wallet || !runtime.setup) throw new Error("Missing wallet or proxy setup metadata");
        const bot = getDefaultBot(ctx);
        const token = await authenticateBot({ ctx, bot });
        if (runtime.setupUtxoRefs?.length && runtime.setupTransactionId) {
          await pollUntilUtxosConsumed({ ctx, walletId: wallet.walletId, token, address: bot.paymentAddress, spentUtxoRefs: runtime.setupUtxoRefs });
        }
        const response = await requestJson<{ proxy?: ProxyRow; error?: string }>({
          url: `${ctx.apiBaseUrl}/api/v1/proxySetupFinalize`,
          method: "POST",
          token,
          body: {
            walletId: wallet.walletId,
            address: bot.paymentAddress,
            txHash: runtime.setupTxHash ?? runtime.setupTransactionId ?? "submitted",
            ...runtime.setup,
            description: `CI proxy setup (${walletType})`,
          },
          retries: 3,
        });
        if (response.status !== 201 || !response.data?.proxy?.id) {
          throw new Error(`proxySetupFinalize failed (${response.status}): ${stringifyRedacted(response.data)}`);
        }
        runtime.proxyId = response.data.proxy.id;
        return { message: `proxySetupFinalize created proxy ${runtime.proxyId}`, artifacts: { proxy: response.data.proxy } };
      },
    },
    {
      id: `v1.proxy.lifecycle.proxies.active.${walletType}`,
      description: `Assert finalized proxy is listed (${walletType})`,
      severity: "critical",
      execute: async (ctx) => {
        const wallet = getWalletByType(ctx, walletType);
        if (!wallet || !runtime.proxyId) throw new Error("Missing wallet or proxy id");
        const bot = getDefaultBot(ctx);
        const token = await authenticateBot({ ctx, bot });
        const response = await requestJson<ProxyRow[] | { error?: string }>({
          url: `${ctx.apiBaseUrl}/api/v1/proxies?walletId=${encodeURIComponent(wallet.walletId)}&address=${encodeURIComponent(bot.paymentAddress)}`,
          method: "GET",
          token,
        });
        if (response.status !== 200 || !Array.isArray(response.data) || !response.data.some((proxy) => proxy.id === runtime.proxyId)) {
          throw new Error(`proxies did not include finalized proxy (${response.status}): ${stringifyRedacted(response.data)}`);
        }
        return { message: `proxies includes active proxy ${runtime.proxyId}`, artifacts: { proxyId: runtime.proxyId } };
      },
    },
  ];
}

function createProxyActionStep(args: {
  id: string;
  description: string;
  walletType: CIWalletType;
  endpoint: "proxySpend" | "proxyDRepCertificate" | "proxyVote" | "proxyCleanup";
  runtime: {
    setup?: ProxySetup;
    proxyId?: string;
    activeProposals?: ActiveProposal[];
    actionTransactionId?: string;
    actionTxHash?: string;
    actionUtxoRefs?: UtxoRef[];
    cleanupPhase?: "sweep" | "burn";
    cleanupBurnSkipped?: boolean;
    cleanupBurnTransactionId?: string;
  };
  buildBody: (ctx: CIBootstrapContext, refs: ProxyActionRequestRefs) => Record<string, unknown> | null;
  selectRefs?: (args: { walletUtxos: ScriptUtxo[]; collateralUtxos: ScriptUtxo[]; authTokenId: string }) => ProxyActionSelection;
  includeAllAuthTokens?: boolean;
  shouldSkip?: () => boolean;
  onSkip?: () => void;
  onSuccess?: () => void;
  beforeResolveRefs?: (ctx: CIBootstrapContext) => Promise<void>;
}): RouteStep {
  return {
    id: args.id,
    description: args.description,
    severity: "critical",
    execute: async (ctx) => {
      const wallet = getWalletByType(ctx, args.walletType);
      if (!wallet || !args.runtime.proxyId || !args.runtime.setup) throw new Error("Missing proxy lifecycle runtime");
      if (args.shouldSkip?.()) {
        args.onSkip?.();
        return { message: `${args.endpoint} skipped`, artifacts: { skipped: true } };
      }
      const bot = getDefaultBot(ctx);
      const token = await authenticateBot({ ctx, bot });
      await args.beforeResolveRefs?.(ctx);
      const [walletUtxos, collateralUtxos] = await Promise.all([
        fetchFreeUtxos({ ctx, walletId: wallet.walletId, token, address: bot.paymentAddress, fresh: true }),
        fetchKeyAddressUtxos({ ctx, address: bot.paymentAddress }),
      ]);
      const selection =
        args.selectRefs?.({ walletUtxos, collateralUtxos, authTokenId: args.runtime.setup.authTokenId }) ??
        selectAuthTokenRefs({
          walletUtxos,
          collateralUtxos,
          authTokenId: args.runtime.setup.authTokenId,
          includeAllAuthTokens: args.includeAllAuthTokens,
        });
      const { requestRefs, selectionArtifacts } = splitProxyActionSelection(selection);
      args.runtime.actionTransactionId = undefined;
      args.runtime.actionTxHash = undefined;
      args.runtime.actionUtxoRefs = undefined;
      const extraBody = args.buildBody(ctx, requestRefs);
      if (!extraBody) {
        return { message: `${args.endpoint} skipped`, artifacts: { skipped: true } };
      }
      const response = await requestJson<unknown | { error?: string }>({
        url: `${ctx.apiBaseUrl}/api/v1/${args.endpoint}`,
        method: "POST",
        token,
        body: {
          walletId: wallet.walletId,
          address: bot.paymentAddress,
          proxyId: args.runtime.proxyId,
          ...requestRefs,
          ...extraBody,
        },
      });
      if (response.status !== 201) {
        throw new Error(`${args.endpoint} failed (${response.status}): ${stringifyRedacted(response.data)}`);
      }
      args.runtime.actionTransactionId = getTransactionId(response.data);
      args.runtime.actionTxHash = getSubmittedTxHash(response.data);
      args.runtime.actionUtxoRefs = requestRefs.utxoRefs;
      if (args.endpoint === "proxyCleanup") {
        args.runtime.cleanupPhase = getCleanupPhase(response.data);
      }
      args.onSuccess?.();
      const hasSelectionArtifacts = Object.keys(selectionArtifacts).length > 0;
      return {
        message: `${args.endpoint} transaction created`,
        artifacts: {
          transactionId: args.runtime.actionTransactionId,
          txHash: args.runtime.actionTxHash,
          cleanupPhase: args.runtime.cleanupPhase,
          collateralRef: requestRefs.collateralRef,
          collateralOwnerSignerIndex: PROXY_LIFECYCLE_COLLATERAL_SIGNER_INDEX,
          signerIndexes: [...PROXY_LIFECYCLE_SIGNER_INDEXES],
          ...(hasSelectionArtifacts ? { selectionArtifacts } : {}),
        },
      };
    },
  };
}

function createActionSigningSteps(args: {
  prefix: string;
  walletType: CIWalletType;
  runtime: { actionTransactionId?: string; actionTxHash?: string };
  shouldSkip?: () => boolean;
}): RouteStep[] {
  return [
    createSignStep({
      id: `${args.prefix}.signer0`,
      description: `${args.prefix} signer index 0 collateral witness`,
      walletType: args.walletType,
      signerIndex: 0,
      mnemonicEnvName: "CI_MNEMONIC_1",
      signBroadcast: false,
      getTransactionId: () => args.runtime.actionTransactionId,
      shouldSkip: args.shouldSkip,
    }),
    createSignStep({
      id: `${args.prefix}.signer1`,
      description: `${args.prefix} signer index 1 broadcast`,
      walletType: args.walletType,
      signerIndex: 1,
      mnemonicEnvName: "CI_MNEMONIC_2",
      signBroadcast: true,
      getTransactionId: () => args.runtime.actionTransactionId,
      shouldSkip: args.shouldSkip,
      setTxHash: (txHash) => {
        args.runtime.actionTxHash = txHash ?? args.runtime.actionTxHash;
      },
    }),
  ];
}

function createWaitForActionConfirmationStep(args: {
  id: string;
  description: string;
  walletType: CIWalletType;
  runtime: { actionTransactionId?: string; actionUtxoRefs?: UtxoRef[] };
  shouldSkip?: () => boolean;
}): RouteStep {
  return {
    id: args.id,
    description: args.description,
    severity: "critical",
    execute: async (ctx) => {
      if (args.shouldSkip?.() || shouldSkipActionConfirmation(args.runtime)) {
        return { message: "Confirmation wait skipped", artifacts: { skipped: true } };
      }
      const wallet = getWalletByType(ctx, args.walletType);
      if (!wallet) throw new Error(`Missing ${args.walletType} wallet`);
      const bot = getDefaultBot(ctx);
      const token = await authenticateBot({ ctx, bot });
      const result = await pollUntilUtxosConsumed({
        ctx,
        walletId: wallet.walletId,
        token,
        address: bot.paymentAddress,
        spentUtxoRefs: args.runtime.actionUtxoRefs!,
      });
      return {
        message: `Confirmed proxy action inputs consumed after ${result.attempts} attempt(s)`,
        artifacts: {
          transactionId: args.runtime.actionTransactionId,
          attempts: result.attempts,
        },
      };
    },
  };
}

function createProxyFullLifecycleHygieneStep(walletType: CIWalletType): RouteStep {
  return {
    id: `v1.proxy.full.hygiene.${walletType}`,
    description: "Clean stale active proxy lifecycle rows before starting",
    severity: "critical",
    execute: async (ctx) => runProxyFullLifecycleHygiene({ ctx, walletType }),
  };
}

function createProxyFullLifecycleChainRecoveryStep(walletType: CIWalletType): RouteStep {
  return {
    id: `v1.proxy.full.recoverFromChain.${walletType}`,
    description: "Recover stale proxy rows from on-chain CI wallet evidence",
    severity: "critical",
    execute: async (ctx) => {
      const result = await recoverProxyRowsFromChainForWalletType({ ctx, walletType });
      return {
        message: result.recovered.length
          ? `recovered ${result.recovered.length} proxy row(s) from chain for ${walletType}`
          : `no proxy rows recovered from chain for ${walletType}`,
        artifacts: normalizeJsonArtifact(result) as Record<string, unknown>,
      };
    },
  };
}

function createProxyFullLifecycleAdoptionStep(walletType: CIWalletType): RouteStep {
  return {
    id: `v1.proxy.full.adoptOrphans.${walletType}`,
    description: "Adopt stale proxy rows from historical deterministic CI wallets",
    severity: "critical",
    execute: async (ctx) => {
      const result = await adoptProxyOrphansForWalletType({ ctx, walletType });
      return {
        message: result.adopted.length
          ? `adopted ${result.adopted.length} orphan proxy row(s) for ${walletType}`
          : `no orphan proxy rows adopted for ${walletType}`,
        artifacts: normalizeJsonArtifact(result) as Record<string, unknown>,
      };
    },
  };
}

function createProxyFullLifecycleSteps(walletType: CIWalletType): RouteStep[] {
  const runtime: {
    setup?: ProxySetup;
    proxyId?: string;
    setupTransactionId?: string;
    setupTxHash?: string;
    setupUtxoRefs?: UtxoRef[];
    actionTransactionId?: string;
    actionTxHash?: string;
    actionUtxoRefs?: UtxoRef[];
    activeProposals?: ActiveProposal[];
    attemptedVote?: boolean;
    cleanupPhase?: "sweep" | "burn";
    cleanupBurnSkipped?: boolean;
    cleanupBurnTransactionId?: string;
  } = {};

  return [
    createProxyFullLifecycleChainRecoveryStep(walletType),
    createProxyFullLifecycleAdoptionStep(walletType),
    createProxyFullLifecycleHygieneStep(walletType),
    {
      id: `v1.proxy.full.utxoShape.${walletType}`,
      description: "Ensure proxy full-lifecycle wallet has separate setup and collateral UTxOs",
      severity: "critical",
      execute: async (runCtx) => {
        const result = await ensureProxyLifecycleUtxoShape({ ctx: runCtx, walletType });
        return {
          message:
            result.status === "already-shaped"
              ? `proxy full lifecycle UTxO shape already satisfied for ${walletType}`
              : `proxy full lifecycle UTxO self-split confirmed for ${walletType}`,
          artifacts: result as unknown as Record<string, unknown>,
        };
      },
    },
    {
      id: `v1.proxy.full.preflight.${walletType}`,
      description: "Verify proxy full-lifecycle ADA budget and UTxO shape",
      severity: "critical",
      execute: async (runCtx) => {
        const wallet = getWalletByType(runCtx, walletType);
        if (!wallet) throw new Error(`Missing ${walletType} wallet`);
        const bot = getDefaultBot(runCtx);
        const token = await authenticateBot({ ctx: runCtx, bot });
        const [walletUtxos, collateralUtxos] = await Promise.all([
          fetchFreeUtxos({
            ctx: runCtx,
            walletId: wallet.walletId,
            token,
            address: bot.paymentAddress,
            fresh: true,
          }),
          fetchKeyAddressUtxos({ ctx: runCtx, address: bot.paymentAddress }),
        ]);
        const result = assertProxyFullLifecyclePreflight({
          walletUtxos,
          collateralUtxos,
        });
        return {
          message: `proxy full lifecycle preflight passed with ${formatAda(result.totalLovelace)} available and ${formatAda(result.requiredTotalLovelace)} required`,
          artifacts: {
            totalLovelace: result.totalLovelace.toString(),
            largestUtxoLovelace: result.largestUtxoLovelace.toString(),
            setupCandidates: result.setupCandidates,
            keyCollateralCandidates: result.keyCollateralCandidates,
            drepSelectableLovelace: result.drepSelectableLovelace.toString(),
            drepRequiredLovelace: result.drepRequiredLovelace.toString(),
            requiredTotalLovelace: result.requiredTotalLovelace.toString(),
          },
        };
      },
    },
    ...createSetupLifecycleSteps({ walletType, runtime }),
    createProxyActionStep({
      id: `v1.proxy.full.spend.propose.${walletType}`,
      description: "Build proxy spend transaction",
      walletType,
      endpoint: "proxySpend",
      runtime,
      buildBody: (runCtx) => ({
        outputs: [{ address: getWalletByType(runCtx, walletType)?.walletAddress ?? "", unit: "lovelace", amount: PROXY_SPEND_LOVELACE.toString() }],
        description: "CI proxy spend",
      }),
    }),
    ...createActionSigningSteps({ prefix: `v1.proxy.full.spend.${walletType}`, walletType, runtime }),
    createWaitForActionConfirmationStep({
      id: `v1.proxy.full.spend.confirmed.${walletType}`,
      description: "Wait for proxy spend inputs to be confirmed consumed",
      walletType,
      runtime,
    }),
    createProxyActionStep({
      id: `v1.proxy.full.drepRegister.propose.${walletType}`,
      description: "Build proxy DRep register transaction",
      walletType,
      endpoint: "proxyDRepCertificate",
      runtime,
      selectRefs: ({ walletUtxos, collateralUtxos, authTokenId }) => {
        return selectDRepRegisterRefs({
          walletUtxos,
          collateralUtxos,
          authTokenId,
          requiredLovelace: DREP_REGISTER_REQUIRED_LOVELACE + FULL_LIFECYCLE_FEE_BUFFER_LOVELACE,
        });
      },
      buildBody: () => ({
        action: "register",
        anchorUrl: getProxyDRepAnchorUrl(),
        anchorJson: { name: "CI Proxy DRep", purpose: "route-chain" },
        description: "CI proxy DRep register",
      }),
    }),
    ...createActionSigningSteps({ prefix: `v1.proxy.full.drepRegister.${walletType}`, walletType, runtime }),
    createWaitForActionConfirmationStep({
      id: `v1.proxy.full.drepRegister.confirmed.${walletType}`,
      description: "Wait for proxy DRep register inputs to be confirmed consumed",
      walletType,
      runtime,
    }),
    {
      id: `v1.proxy.full.activeProposals.${walletType}`,
      description: "Fetch active proposals for optional proxy vote",
      severity: "critical",
      execute: async (runCtx) => {
        const bot = getDefaultBot(runCtx);
        const token = await authenticateBot({ ctx: runCtx, bot });
        const response = await requestJson<{ proposals?: unknown[]; activeCount?: number; sourceCount?: number; error?: string }>({
          url: `${runCtx.apiBaseUrl}/api/v1/governanceActiveProposals?network=0&count=20&page=1&order=desc&details=false`,
          method: "GET",
          token,
        });
        if (response.status !== 200) {
          throw new Error(`governanceActiveProposals failed (${response.status}): ${stringifyRedacted(response.data)}`);
        }
        runtime.activeProposals = getDeterministicActiveProposals(response.data, 1);
        return {
          message: `selected ${runtime.activeProposals.length} active proposal(s) for optional proxy vote`,
          artifacts: { selectedProposalIds: runtime.activeProposals.map((proposal) => proposal.proposalId) },
        };
      },
    },
    createProxyActionStep({
      id: `v1.proxy.full.vote.propose.${walletType}`,
      description: "Build proxy vote transaction when proposals exist",
      walletType,
      endpoint: "proxyVote",
      runtime,
      selectRefs: ({ walletUtxos, collateralUtxos, authTokenId }) =>
        selectAuthTokenRefsWithMinLovelace({
          walletUtxos,
          collateralUtxos,
          authTokenId,
          requiredLovelace: PROXY_ACTION_REQUIRED_LOVELACE + PROXY_ACTION_FEE_BUFFER_LOVELACE,
          context: "proxy vote",
        }),
      buildBody: () => {
        const proposal = runtime.activeProposals?.[0];
        if (!proposal) return null;
        runtime.attemptedVote = true;
        return {
          votes: [{ proposalId: proposal.proposalId, voteKind: "Abstain" }],
          description: "CI proxy vote",
        };
      },
    }),
    ...createActionSigningSteps({ prefix: `v1.proxy.full.vote.${walletType}`, walletType, runtime }),
    createWaitForActionConfirmationStep({
      id: `v1.proxy.full.vote.confirmed.${walletType}`,
      description: "Wait for proxy vote inputs to be confirmed consumed",
      walletType,
      runtime,
    }),
    createProxyActionStep({
      id: `v1.proxy.full.drepDeregister.propose.${walletType}`,
      description: "Build proxy DRep deregister transaction",
      walletType,
      endpoint: "proxyDRepCertificate",
      runtime,
      selectRefs: ({ walletUtxos, collateralUtxos, authTokenId }) =>
        selectAuthTokenRefsWithMinLovelace({
          walletUtxos,
          collateralUtxos,
          authTokenId,
          requiredLovelace: PROXY_ACTION_REQUIRED_LOVELACE + PROXY_ACTION_FEE_BUFFER_LOVELACE,
          context: "proxy DRep deregister",
        }),
      buildBody: () => ({
        action: "deregister",
        description: "CI proxy DRep deregister",
      }),
    }),
    ...createActionSigningSteps({ prefix: `v1.proxy.full.drepDeregister.${walletType}`, walletType, runtime }),
    createWaitForActionConfirmationStep({
      id: `v1.proxy.full.drepDeregister.confirmed.${walletType}`,
      description: "Wait for proxy DRep deregister inputs to be confirmed consumed",
      walletType,
      runtime,
    }),
    createProxyActionStep({
      id: `v1.proxy.full.cleanup.initial.propose.${walletType}`,
      description: "Build initial proxy cleanup transaction",
      walletType,
      endpoint: "proxyCleanup",
      runtime,
      includeAllAuthTokens: true,
      buildBody: () => ({
        deactivateProxy: true,
        description: "CI proxy cleanup",
      }),
    }),
    ...createActionSigningSteps({ prefix: `v1.proxy.full.cleanup.initial.${walletType}`, walletType, runtime }),
    createWaitForActionConfirmationStep({
      id: `v1.proxy.full.cleanup.initial.confirmed.${walletType}`,
      description: "Wait for initial proxy cleanup inputs to be confirmed consumed",
      walletType,
      runtime,
    }),
    createProxyActionStep({
      id: `v1.proxy.full.cleanup.burn.propose.${walletType}`,
      description: "Build proxy cleanup burn transaction after sweep",
      walletType,
      endpoint: "proxyCleanup",
      runtime,
      includeAllAuthTokens: true,
      shouldSkip: () => shouldSkipCleanupBurnPropose(runtime),
      onSkip: () => {
        runtime.cleanupBurnSkipped = true;
        runtime.cleanupBurnTransactionId = undefined;
      },
      onSuccess: () => {
        runtime.cleanupBurnSkipped = false;
        runtime.cleanupBurnTransactionId = runtime.actionTransactionId;
      },
      buildBody: () => ({
        deactivateProxy: true,
        description: "CI proxy cleanup burn",
      }),
    }),
    ...createActionSigningSteps({
      prefix: `v1.proxy.full.cleanup.burn.${walletType}`,
      walletType,
      runtime,
      shouldSkip: () => shouldSkipCleanupBurnSigning(runtime),
    }),
    createWaitForActionConfirmationStep({
      id: `v1.proxy.full.cleanup.burn.confirmed.${walletType}`,
      description: "Wait for proxy cleanup burn inputs to be confirmed consumed",
      walletType,
      runtime,
      shouldSkip: () => shouldSkipCleanupBurnSigning(runtime),
    }),
    {
      id: `v1.proxy.full.cleanup.finalize.${walletType}`,
      description: "Finalize proxy cleanup and deactivate proxy",
      severity: "critical",
      execute: async (runCtx) => {
        const wallet = getWalletByType(runCtx, walletType);
        if (!wallet || !runtime.proxyId) throw new Error("Missing wallet or proxy id for cleanup finalize");
        const bot = getDefaultBot(runCtx);
        const token = await authenticateBot({ ctx: runCtx, bot });
        if (runtime.actionUtxoRefs?.length && runtime.actionTransactionId) {
          await pollUntilUtxosConsumed({ ctx: runCtx, walletId: wallet.walletId, token, address: bot.paymentAddress, spentUtxoRefs: runtime.actionUtxoRefs });
        }
        const response = await requestJson<{ proxy?: ProxyRow; error?: string }>({
          url: `${runCtx.apiBaseUrl}/api/v1/proxyCleanupFinalize`,
          method: "POST",
          token,
          body: {
            walletId: wallet.walletId,
            address: bot.paymentAddress,
            proxyId: runtime.proxyId,
            txHash: runtime.actionTxHash ?? runtime.actionTransactionId ?? "submitted",
          },
          retries: 3,
        });
        if (response.status !== 201 || response.data?.proxy?.isActive !== false) {
          throw new Error(`proxyCleanupFinalize failed (${response.status}): ${stringifyRedacted(response.data)}`);
        }
        return { message: `proxy ${runtime.proxyId} deactivated after cleanup`, artifacts: { proxy: response.data.proxy } };
      },
    },
    {
      id: `v1.proxy.full.cleanup.proxies.inactive.${walletType}`,
      description: "Assert cleaned proxy is no longer listed as active",
      severity: "critical",
      execute: async (runCtx) => {
        const wallet = getWalletByType(runCtx, walletType);
        if (!wallet || !runtime.proxyId) throw new Error("Missing wallet or proxy id after cleanup");
        const bot = getDefaultBot(runCtx);
        const token = await authenticateBot({ ctx: runCtx, bot });
        const response = await requestJson<ProxyRow[] | { error?: string }>({
          url: `${runCtx.apiBaseUrl}/api/v1/proxies?walletId=${encodeURIComponent(wallet.walletId)}&address=${encodeURIComponent(bot.paymentAddress)}`,
          method: "GET",
          token,
        });
        if (response.status !== 200 || !Array.isArray(response.data)) {
          throw new Error(`proxies list failed after cleanup (${response.status}): ${stringifyRedacted(response.data)}`);
        }
        if (response.data.some((proxy) => proxy.id === runtime.proxyId)) {
          throw new Error(`cleaned proxy ${runtime.proxyId} is still listed as active`);
        }
        return { message: `proxy ${runtime.proxyId} is no longer listed as active` };
      },
    },
  ];
}

export function createScenarioProxyFullLifecycle(ctx: CIBootstrapContext): Scenario {
  const eligibleWalletTypes = PROXY_FULL_LIFECYCLE_WALLET_TYPES.filter(
    (walletType) =>
      ctx.walletTypes.includes(walletType) &&
      ctx.wallets.some((wallet) => wallet.type === walletType),
  );

  const steps: RouteStep[] = eligibleWalletTypes.length
    ? eligibleWalletTypes.flatMap((walletType) => createProxyFullLifecycleSteps(walletType))
    : [
        {
          id: "v1.proxy.full.precondition",
          description: "Assert proxy full lifecycle has an eligible wallet type",
          severity: "critical",
          execute: async () => {
            throw new Error(
              `scenario.proxy-full-lifecycle requires at least one of ${PROXY_FULL_LIFECYCLE_WALLET_TYPES.join(", ")} in CI_WALLET_TYPES`,
            );
          },
        },
      ];

  return {
    id: "scenario.proxy-full-lifecycle",
    description: "Proxy spend, governance, and cleanup lifecycle for legacy and SDK wallets",
    steps,
  };
}
