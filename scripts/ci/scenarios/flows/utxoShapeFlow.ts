import { createPrismaClient } from "../../framework/prismaClient";
import type { CIBootstrapContext, CIWalletType } from "../../framework/types";
import { authenticateBot } from "../../framework/botAuth";
import { getDefaultBot } from "../../framework/botContext";
import { boolFromEnv } from "../../framework/env";
import { requestJson } from "../../framework/http";
import { parseMnemonic } from "../../framework/mnemonic";
import { isTestnetAddress } from "../../framework/preprod";
import { stringifyRedacted } from "../../framework/redact";
import {
  analyzeProxyFullLifecycleUtxoShape,
  assertProxyFullLifecyclePreflight,
  formatAda,
  key,
  PROXY_LIFECYCLE_COLLATERAL_SPLIT_LOVELACE,
  type ScriptUtxo,
  type UtxoRef,
  toRef,
} from "../proxyLifecyclePreflight";
import { runSigningFlow } from "./signingFlow";
import { getWalletByType } from "../steps/helpers";

const prisma = createPrismaClient();

type UtxoShapeResult = {
  walletType: CIWalletType;
  walletId: string;
  status: "already-shaped" | "split";
  transactionId?: string;
  spentUtxoRefs?: UtxoRef[];
  attempts?: number;
  totalLovelace: string;
  requiredTotalLovelace: string;
  drepSelectableLovelace: string;
  keyCollateralCandidates: number;
};

async function loadScriptCbor(walletId: string): Promise<string> {
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { scriptCbor: true },
  });
  const scriptCbor = wallet?.scriptCbor?.trim();
  if (!scriptCbor) {
    throw new Error(`Wallet ${walletId} is missing scriptCbor; cannot build proxy lifecycle self-split`);
  }
  return scriptCbor;
}

async function fetchFreshFreeUtxos(args: {
  ctx: CIBootstrapContext;
  walletId: string;
  token: string;
  address: string;
}): Promise<ScriptUtxo[]> {
  const response = await requestJson<ScriptUtxo[] | { error?: string }>({
    url: `${args.ctx.apiBaseUrl}/api/v1/freeUtxos?walletId=${encodeURIComponent(args.walletId)}&address=${encodeURIComponent(args.address)}&fresh=true`,
    method: "GET",
    token: args.token,
  });
  if (response.status !== 200 || !Array.isArray(response.data)) {
    throw new Error(`freeUtxos UTxO-shape lookup failed (${response.status}): ${stringifyRedacted(response.data)}`);
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
    const utxos = await fetchFreshFreeUtxos(args);
    if (!utxos.some((utxo) => spent.has(key(toRef(utxo))))) {
      return { attempts: attempt + 1 };
    }
  }
  throw new Error("Timed out waiting for proxy lifecycle self-split inputs to be confirmed");
}

function requireProxyShapeEnvironment(ctx: CIBootstrapContext, walletAddress: string, collateralAddress: string): void {
  const apiKey = process.env.CI_BLOCKFROST_PREPROD_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("CI_BLOCKFROST_PREPROD_API_KEY is required for proxy lifecycle UTxO shaping");
  }
  if (ctx.networkId !== 0) {
    throw new Error(`Proxy lifecycle UTxO shaping is preprod-only. Expected networkId=0, received networkId=${ctx.networkId}`);
  }
  if (!isTestnetAddress(walletAddress)) {
    throw new Error(`Preprod invariant failed: proxy lifecycle wallet address is not testnet (${walletAddress})`);
  }
  if (!isTestnetAddress(collateralAddress)) {
    throw new Error(`Preprod invariant failed: proxy lifecycle collateral address is not testnet (${collateralAddress})`);
  }
  for (const envName of ["CI_MNEMONIC_2", "CI_MNEMONIC_3"] as const) {
    if (!process.env[envName]?.trim()) {
      throw new Error(`${envName} is required for proxy lifecycle UTxO shaping`);
    }
    parseMnemonic(process.env[envName]!);
  }
}

async function buildSelfSplitTransaction(args: {
  walletId: string;
  walletAddress: string;
  collateralAddress: string;
  utxos: ScriptUtxo[];
}): Promise<string> {
  const apiKey = process.env.CI_BLOCKFROST_PREPROD_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("CI_BLOCKFROST_PREPROD_API_KEY is required for proxy lifecycle UTxO shaping");
  }
  const scriptCbor = await loadScriptCbor(args.walletId);
  const { MeshTxBuilder, BlockfrostProvider } = await import("@meshsdk/core");
  const provider = new BlockfrostProvider(apiKey);
  const txBuilder = new MeshTxBuilder({
    fetcher: provider,
    evaluator: provider,
    verbose: true,
  });
  txBuilder.setNetwork("preprod");
  for (const utxo of args.utxos) {
    txBuilder
      .txIn(
        utxo.input.txHash,
        utxo.input.outputIndex,
        utxo.output.amount,
        utxo.output.address,
      )
      .txInScript(scriptCbor);
  }
  txBuilder.txOut(args.collateralAddress, [
    {
      unit: "lovelace",
      quantity: PROXY_LIFECYCLE_COLLATERAL_SPLIT_LOVELACE.toString(),
    },
  ]);
  txBuilder.changeAddress(args.walletAddress);
  const unsignedTxHex = await txBuilder.complete();
  if (!unsignedTxHex || typeof unsignedTxHex !== "string") {
    throw new Error("Failed to build unsigned proxy lifecycle self-split transaction");
  }
  return unsignedTxHex;
}

export async function ensureProxyLifecycleUtxoShape(args: {
  ctx: CIBootstrapContext;
  walletType: CIWalletType;
  minKeyCollateralCandidates?: number;
}): Promise<UtxoShapeResult> {
  const wallet = getWalletByType(args.ctx, args.walletType);
  if (!wallet) throw new Error(`Missing ${args.walletType} wallet`);
  if (!wallet.walletAddress) {
    throw new Error(`Wallet ${wallet.walletId} is missing walletAddress; cannot shape proxy lifecycle UTxOs`);
  }

  const bot = getDefaultBot(args.ctx);
  const token = await authenticateBot({ ctx: args.ctx, bot });
  const [utxos, collateralUtxos] = await Promise.all([
    fetchFreshFreeUtxos({
      ctx: args.ctx,
      walletId: wallet.walletId,
      token,
      address: bot.paymentAddress,
    }),
    fetchKeyAddressUtxos({ ctx: args.ctx, address: bot.paymentAddress }),
  ]);
  const analysis = analyzeProxyFullLifecycleUtxoShape({
    walletUtxos: utxos,
    collateralUtxos,
    minKeyCollateralCandidates: args.minKeyCollateralCandidates,
  });
  if (analysis.status === "pass") {
    return {
      walletType: args.walletType,
      walletId: wallet.walletId,
      status: "already-shaped",
      totalLovelace: analysis.totalLovelace.toString(),
      requiredTotalLovelace: analysis.requiredTotalLovelace.toString(),
      drepSelectableLovelace: analysis.drepSelectableLovelace.toString(),
      keyCollateralCandidates: analysis.keyCollateralCandidates,
    };
  }
  if (analysis.status !== "needs-split") {
    if (analysis.status === "insufficient-shape") {
      throw new Error(
        `Proxy lifecycle self-split cannot leave ${formatAda(PROXY_LIFECYCLE_COLLATERAL_SPLIT_LOVELACE)} collateral plus enough selectable ADA. ${analysis.diagnostics}. Add at least ${formatAda(analysis.selfSplitRequiredLovelace - analysis.totalLovelace)} plus any desired safety margin before running proxy full lifecycle.`,
      );
    }
    assertProxyFullLifecyclePreflight({
      walletUtxos: utxos,
      collateralUtxos,
      minKeyCollateralCandidates: args.minKeyCollateralCandidates,
    });
  }

  requireProxyShapeEnvironment(args.ctx, wallet.walletAddress, bot.paymentAddress);
  const unsignedTxHex = await buildSelfSplitTransaction({
    walletId: wallet.walletId,
    walletAddress: wallet.walletAddress,
    collateralAddress: bot.paymentAddress,
    utxos,
  });
  const addResponse = await requestJson<{ id?: string; error?: string }>({
    url: `${args.ctx.apiBaseUrl}/api/v1/addTransaction`,
    method: "POST",
    token,
    body: {
      walletId: wallet.walletId,
      address: bot.paymentAddress,
      txCbor: unsignedTxHex,
      txJson: JSON.stringify({
        source: "ci-route-chain",
        kind: "proxy-lifecycle-utxo-shape",
        walletType: args.walletType,
        outputCollateralLovelace: PROXY_LIFECYCLE_COLLATERAL_SPLIT_LOVELACE.toString(),
        outputCollateralAddress: bot.paymentAddress,
        sourceUtxoCount: utxos.length,
        totalLovelace: analysis.totalLovelace.toString(),
      }),
      description: `CI proxy lifecycle UTxO self-split (${args.walletType})`,
    },
  });
  if (addResponse.status !== 201 || !addResponse.data?.id) {
    throw new Error(`addTransaction proxy UTxO self-split failed (${addResponse.status}): ${stringifyRedacted(addResponse.data)}`);
  }

  const transactionId = addResponse.data.id;
  await runSigningFlow({
    ctx: args.ctx,
    mnemonic: process.env.CI_MNEMONIC_2!,
    signWalletType: args.walletType,
    signerIndex: 1,
    signerLabel: "signer1",
    signBroadcast: false,
    preferredTransactionId: transactionId,
    requireBroadcastSuccess: false,
  });
  await runSigningFlow({
    ctx: args.ctx,
    mnemonic: process.env.CI_MNEMONIC_3!,
    signWalletType: args.walletType,
    signerIndex: 2,
    signerLabel: "signer2",
    signBroadcast: boolFromEnv(process.env.SIGN_BROADCAST, true),
    preferredTransactionId: transactionId,
    requireBroadcastSuccess: true,
  });

  const spentUtxoRefs = utxos.map(toRef);
  const confirmation = await pollUntilUtxosConsumed({
    ctx: args.ctx,
    walletId: wallet.walletId,
    token,
    address: bot.paymentAddress,
    spentUtxoRefs,
  });
  const [shapedUtxos, shapedCollateralUtxos] = await Promise.all([
    fetchFreshFreeUtxos({
      ctx: args.ctx,
      walletId: wallet.walletId,
      token,
      address: bot.paymentAddress,
    }),
    fetchKeyAddressUtxos({ ctx: args.ctx, address: bot.paymentAddress }),
  ]);
  const shaped = assertProxyFullLifecyclePreflight({
    walletUtxos: shapedUtxos,
    collateralUtxos: shapedCollateralUtxos,
    minKeyCollateralCandidates: args.minKeyCollateralCandidates,
  });

  return {
    walletType: args.walletType,
    walletId: wallet.walletId,
    status: "split",
    transactionId,
    spentUtxoRefs,
    attempts: confirmation.attempts,
    totalLovelace: shaped.totalLovelace.toString(),
    requiredTotalLovelace: shaped.requiredTotalLovelace.toString(),
    drepSelectableLovelace: shaped.drepSelectableLovelace.toString(),
    keyCollateralCandidates: shaped.keyCollateralCandidates,
  };
}
