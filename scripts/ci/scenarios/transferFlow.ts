import type { CIBootstrapContext, CIWalletType } from "../framework/types";
import { requestJson } from "../framework/http";
import { getDefaultBot } from "../framework/botContext";
import { authenticateBot } from "../framework/botAuth";
import { stringifyRedacted } from "../framework/redact";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseMnemonic(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeWalletType(value: string): CIWalletType {
  const v = value.trim().toLowerCase();
  if (v === "hierarchical" || v === "sdk") return v;
  return "legacy";
}

type TransferSeedResult = {
  fromWalletType: CIWalletType;
  toWalletType: CIWalletType;
  fromWalletId: string;
  toWalletId: string;
  transferFromAddress: string;
  transferToAddress: string;
  transferAmountLovelace: string;
  transactionId: string;
};

type UTxOAmount = {
  unit: string;
  quantity: string;
};

type ScriptUtxo = {
  input: {
    txHash: string;
    outputIndex: number;
  };
  output: {
    address: string;
    amount: UTxOAmount[];
  };
};

function isTestnetAddress(address: string): boolean {
  return address.startsWith("addr_test") || address.startsWith("stake_test");
}

function parseLovelace(amounts: UTxOAmount[]): bigint {
  const lovelace = amounts.find((asset) => asset.unit === "lovelace")?.quantity ?? "0";
  try {
    return BigInt(lovelace);
  } catch {
    return 0n;
  }
}

async function loadScriptCbor(walletId: string): Promise<string> {
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { scriptCbor: true },
  });
  const scriptCbor = wallet?.scriptCbor?.trim();
  if (!scriptCbor) {
    throw new Error(`Wallet ${walletId} is missing scriptCbor; cannot build multisig input transaction`);
  }
  return scriptCbor;
}

export async function seedRealTransferTransaction(args: {
  ctx: CIBootstrapContext;
  fromMnemonic: string;
  fromWalletType: string;
  toWalletType: string;
  transferLovelace?: string;
}): Promise<TransferSeedResult> {
  const { ctx } = args;
  const defaultBot = getDefaultBot(ctx);
  const defaultBotToken = await authenticateBot({ ctx, bot: defaultBot });
  const fromWalletType = normalizeWalletType(args.fromWalletType);
  const toWalletType = normalizeWalletType(args.toWalletType);
  const fromWallet = ctx.wallets.find((w) => w.type === fromWalletType);
  if (!fromWallet) {
    throw new Error(`Unable to find source wallet context for type ${fromWalletType}`);
  }
  const toWallet = ctx.wallets.find((w) => w.type === toWalletType);
  if (!toWallet) {
    throw new Error(`Unable to find destination wallet context for type ${toWalletType}`);
  }

  if (fromWallet.walletId === toWallet.walletId) {
    throw new Error(`Source and destination wallets must differ for transfer leg ${fromWalletType}`);
  }

  const transferToAddress = toWallet.walletAddress;
  if (!transferToAddress) {
    throw new Error(`Destination wallet ${toWallet.walletId} is missing walletAddress`);
  }
  const transferFromAddress = fromWallet.walletAddress;
  if (!transferFromAddress) {
    throw new Error(`Source wallet ${fromWallet.walletId} is missing walletAddress`);
  }

  const transferAmountLovelace = (() => {
    const raw = (args.transferLovelace ?? process.env.CI_TRANSFER_LOVELACE ?? "2000000").trim();
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1_000_000) {
      throw new Error("CI_TRANSFER_LOVELACE must be a number >= 1000000");
    }
    return String(Math.trunc(n));
  })();

  const apiKey = process.env.CI_BLOCKFROST_PREPROD_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("CI_BLOCKFROST_PREPROD_API_KEY is required for real transfer scenario");
  }
  if (ctx.networkId !== 0) {
    throw new Error(
      `CI route-chain transfer scenario is preprod-only. Expected networkId=0, received networkId=${ctx.networkId}`,
    );
  }

  for (const address of [
    transferFromAddress,
    transferToAddress,
    ...fromWallet.signerAddresses,
    ...toWallet.signerAddresses,
  ]) {
    if (!isTestnetAddress(address)) {
      throw new Error(`Preprod invariant failed: non-testnet address detected: ${address}`);
    }
  }

  const { MeshWallet, MeshTxBuilder, BlockfrostProvider } = await import("@meshsdk/core");
  const provider = new BlockfrostProvider(apiKey);
  const signerWallet = new MeshWallet({
    networkId: ctx.networkId,
    key: { type: "mnemonic", words: parseMnemonic(args.fromMnemonic) },
  });
  await signerWallet.init();
  const signerAddress = await signerWallet.getChangeAddress();
  const expectedFromAddress = fromWallet.signerAddresses?.[1];
  if (!expectedFromAddress || signerAddress !== expectedFromAddress) {
    throw new Error(
      `Transfer mnemonic does not match expected signerAddresses[1] for source wallet ${fromWalletType}`,
    );
  }
  if (!isTestnetAddress(signerAddress)) {
    throw new Error(`Preprod invariant failed: transfer signer is not a testnet address (${signerAddress})`);
  }

  const sourceWalletScriptCbor = await loadScriptCbor(fromWallet.walletId);
  const freeUtxosResponse = await requestJson<ScriptUtxo[] | { error?: string }>({
    url: `${ctx.apiBaseUrl}/api/v1/freeUtxos?walletId=${encodeURIComponent(fromWallet.walletId)}&address=${encodeURIComponent(defaultBot.paymentAddress)}`,
    method: "GET",
    token: defaultBotToken,
  });
  if (freeUtxosResponse.status !== 200 || !Array.isArray(freeUtxosResponse.data)) {
    throw new Error(
      `freeUtxos transfer preflight failed (${freeUtxosResponse.status}): ${stringifyRedacted(freeUtxosResponse.data)}`,
    );
  }
  if (freeUtxosResponse.data.length === 0) {
    throw new Error(
      `No free UTxOs available for source wallet ${fromWalletType} (${fromWallet.walletId}) at ${transferFromAddress}`,
    );
  }

  const availableLovelace = freeUtxosResponse.data.reduce((sum, utxo) => {
    return sum + parseLovelace(utxo.output.amount);
  }, 0n);
  const transferAmount = BigInt(transferAmountLovelace);
  const feeBuffer = 1_000_000n;
  const minimumRequired = transferAmount + feeBuffer;
  if (availableLovelace < minimumRequired) {
    throw new Error(
      `Insufficient multisig wallet balance for transfer: available=${availableLovelace.toString()} lovelace, required>=${minimumRequired.toString()} (amount=${transferAmountLovelace}, feeBuffer=${feeBuffer.toString()})`,
    );
  }

  const txBuilder = new MeshTxBuilder({
    fetcher: provider,
    evaluator: provider,
    verbose: true,
  });
  txBuilder.setNetwork("preprod");
  for (const utxo of freeUtxosResponse.data) {
    txBuilder
      .txIn(
        utxo.input.txHash,
        utxo.input.outputIndex,
        utxo.output.amount,
        utxo.output.address,
      )
      .txInScript(sourceWalletScriptCbor);
  }
  txBuilder.txOut(transferToAddress, [
    {
      unit: "lovelace",
      quantity: transferAmountLovelace,
    },
  ]);
  txBuilder.changeAddress(transferFromAddress);
  const unsignedTxHex = await txBuilder.complete();
  if (!unsignedTxHex || typeof unsignedTxHex !== "string") {
    throw new Error("Failed to build unsigned transfer transaction");
  }

  const addResponse = await requestJson<{ id?: string; error?: string }>({
    url: `${ctx.apiBaseUrl}/api/v1/addTransaction`,
    method: "POST",
    token: defaultBotToken,
    body: {
      walletId: fromWallet.walletId,
      address: defaultBot.paymentAddress,
      txCbor: unsignedTxHex,
      txJson: JSON.stringify({
        source: "ci-route-chain",
        kind: "real-transfer",
        fromWalletType,
        toWalletType,
        from: transferFromAddress,
        to: transferToAddress,
        fundingSource: "source-multisig-utxos",
        amountLovelace: transferAmountLovelace,
        sourceUtxoCount: freeUtxosResponse.data.length,
        availableLovelace: availableLovelace.toString(),
      }),
      description: `CI real transfer route-chain tx (${fromWalletType} -> ${toWalletType})`,
    },
  });
  if (addResponse.status !== 201 || !addResponse.data?.id) {
    throw new Error(
      `addTransaction real-transfer failed (${addResponse.status}): ${stringifyRedacted(addResponse.data)}`,
    );
  }

  return {
    fromWalletType,
    toWalletType,
    fromWalletId: fromWallet.walletId,
    toWalletId: toWallet.walletId,
    transferFromAddress,
    transferToAddress,
    transferAmountLovelace,
    transactionId: addResponse.data.id,
  };
}
