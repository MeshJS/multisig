import type { CIBootstrapContext, CIWalletType } from "../framework/types";
import { requestJson } from "../framework/http";
import { getDefaultBot } from "../framework/botContext";
import { authenticateBot } from "../framework/botAuth";
import { stringifyRedacted } from "../framework/redact";

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
  walletType: CIWalletType;
  walletId: string;
  transferFromAddress: string;
  transferToAddress: string;
  transferAmountLovelace: string;
  transactionId: string;
};

export async function seedRealTransferTransaction(args: {
  ctx: CIBootstrapContext;
  fromMnemonic: string;
  walletType?: string;
  transferLovelace?: string;
}): Promise<TransferSeedResult> {
  const { ctx } = args;
  const defaultBot = getDefaultBot(ctx);
  const defaultBotToken = await authenticateBot({ ctx, bot: defaultBot });
  const walletType = normalizeWalletType(args.walletType ?? "legacy");
  const selectedWallet = ctx.wallets.find((w) => w.type === walletType);
  if (!selectedWallet) {
    throw new Error(`Unable to find wallet context for type ${walletType}`);
  }

  const transferToAddress = selectedWallet.signerAddresses?.[2];
  if (!transferToAddress) {
    throw new Error(`Wallet ${selectedWallet.walletId} is missing signerAddresses[2]`);
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

  const { MeshWallet, Transaction, BlockfrostProvider } = await import("@meshsdk/core");
  const provider = new BlockfrostProvider(apiKey);
  const signerWallet = new MeshWallet({
    networkId: ctx.networkId,
    key: { type: "mnemonic", words: parseMnemonic(args.fromMnemonic) },
  });
  await signerWallet.init();
  const transferFromAddress = await signerWallet.getChangeAddress();
  const expectedFromAddress = selectedWallet.signerAddresses?.[1];
  if (!expectedFromAddress || transferFromAddress !== expectedFromAddress) {
    throw new Error("Transfer mnemonic does not match expected signerAddresses[1] for selected wallet");
  }

  const tx = new Transaction({
    initiator: signerWallet,
    fetcher: provider,
    submitter: provider,
    verbose: true,
  });
  tx.sendLovelace(transferToAddress, transferAmountLovelace);
  tx.setChangeAddress(transferFromAddress);
  const unsignedTxHex = await tx.build();
  if (!unsignedTxHex || typeof unsignedTxHex !== "string") {
    throw new Error("Failed to build unsigned transfer transaction");
  }

  const addResponse = await requestJson<{ id?: string; error?: string }>({
    url: `${ctx.apiBaseUrl}/api/v1/addTransaction`,
    method: "POST",
    token: defaultBotToken,
    body: {
      walletId: selectedWallet.walletId,
      address: defaultBot.paymentAddress,
      txCbor: unsignedTxHex,
      txJson: JSON.stringify({
        source: "ci-route-chain",
        kind: "real-transfer",
        walletType,
        from: transferFromAddress,
        to: transferToAddress,
        amountLovelace: transferAmountLovelace,
      }),
      description: `CI real transfer route-chain tx (${walletType})`,
    },
  });
  if (addResponse.status !== 201 || !addResponse.data?.id) {
    throw new Error(
      `addTransaction real-transfer failed (${addResponse.status}): ${stringifyRedacted(addResponse.data)}`,
    );
  }

  return {
    walletType,
    walletId: selectedWallet.walletId,
    transferFromAddress,
    transferToAddress,
    transferAmountLovelace,
    transactionId: addResponse.data.id,
  };
}
