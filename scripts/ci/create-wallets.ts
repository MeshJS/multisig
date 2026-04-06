import { createHmac } from "crypto";
import { BotWalletRole, PrismaClient } from "@prisma/client";
import { stringifyRedacted } from "./framework/redact";

const prisma = new PrismaClient();

type CIWalletType = "legacy" | "hierarchical" | "sdk";

type PaymentNativeScript =
  | { type: "sig"; keyHash: string }
  | { type: "all"; scripts: PaymentNativeScript[] }
  | { type: "any"; scripts: PaymentNativeScript[] }
  | { type: "atLeast"; required: number; scripts: PaymentNativeScript[] };

type CIBotBootstrap = {
  id: string;
  paymentAddress: string;
  botKeyId: string;
  botId: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function parseMnemonic(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function parseWalletTypes(raw: string): CIWalletType[] {
  const allowed = new Set(["legacy", "hierarchical", "sdk"]);
  const requested = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!requested.length) {
    throw new Error("CI_WALLET_TYPES must include at least one wallet type");
  }
  const invalid = requested.filter((value) => !allowed.has(value));
  if (invalid.length) {
    throw new Error(
      `CI_WALLET_TYPES contains unsupported value(s): ${invalid.join(", ")}. Allowed: legacy,hierarchical,sdk`,
    );
  }
  return requested as CIWalletType[];
}

function hashBotSecret(secret: string, jwtSecret: string): string {
  return createHmac("sha256", jwtSecret).update(secret, "utf8").digest("hex");
}

function deriveCiBotSecret(paymentAddress: string, jwtSecret: string): string {
  return createHmac("sha256", jwtSecret)
    .update(`ci-bot-secret:${paymentAddress}`, "utf8")
    .digest("hex");
}

async function deriveAddress(words: string[], networkId: 0 | 1): Promise<string> {
  const { MeshWallet } = await import("@meshsdk/core");
  const wallet = new MeshWallet({
    networkId,
    key: { type: "mnemonic", words },
  });
  await wallet.init();
  return wallet.getChangeAddress();
}

async function main() {
  const apiBaseUrl = (process.env.API_BASE_URL ?? "http://app:3000").trim().replace(/\/$/, "");
  const jwtSecret = requireEnv("CI_JWT_SECRET");
  const mnemonic1 = requireEnv("CI_MNEMONIC_1");
  const mnemonic2 = requireEnv("CI_MNEMONIC_2");
  const mnemonic3 = requireEnv("CI_MNEMONIC_3");
  const walletTypes = parseWalletTypes(
    process.env.CI_WALLET_TYPES ?? "legacy,hierarchical,sdk",
  );
  const parsedNetworkId = Number(process.env.CI_NETWORK_ID ?? "0");
  const networkId: 0 | 1 = parsedNetworkId === 1 ? 1 : 0;
  const requiredSigners = Math.max(
    1,
    Number.isFinite(Number(process.env.CI_NUM_REQUIRED_SIGNERS ?? "2"))
      ? Number(process.env.CI_NUM_REQUIRED_SIGNERS ?? "2")
      : 2,
  );
  const contextPath = process.env.CI_CONTEXT_PATH ?? "/tmp/ci-wallet-context.json";

  const signerAddresses = await Promise.all([
    deriveAddress(parseMnemonic(mnemonic1), networkId),
    deriveAddress(parseMnemonic(mnemonic2), networkId),
    deriveAddress(parseMnemonic(mnemonic3), networkId),
  ]);

  const signerBots: CIBotBootstrap[] = [];
  const botAuthByAddress: Record<string, string> = {};
  for (let i = 0; i < signerAddresses.length; i++) {
    const paymentAddress = signerAddresses[i];
    if (!paymentAddress) {
      throw new Error(`Missing signer address at index ${i}`);
    }
    const botSecret = deriveCiBotSecret(paymentAddress, jwtSecret);
    const botKey = await prisma.botKey.create({
      data: {
        ownerAddress: `ci-owner-${Date.now()}-${i}`,
        name: `ci-bot-signer-${i}-${Date.now()}`,
        keyHash: hashBotSecret(botSecret, jwtSecret),
        scope: JSON.stringify([
          "multisig:create",
          "multisig:read",
          "multisig:sign",
          "governance:read",
          "ballot:write",
        ]),
      },
    });

    const botAuthResponse = await fetch(`${apiBaseUrl}/api/v1/botAuth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        botKeyId: botKey.id,
        secret: botSecret,
        paymentAddress,
      }),
    });
    const botAuthBody = await botAuthResponse.json();
    if (!botAuthResponse.ok || !botAuthBody?.token || !botAuthBody?.botId) {
      throw new Error(
        `botAuth failed for signer index ${i} (${botAuthResponse.status}): ${stringifyRedacted(botAuthBody)}`,
      );
    }

    signerBots.push({
      id: `signer${i}`,
      paymentAddress,
      botKeyId: botKey.id,
      botId: botAuthBody.botId as string,
    });
    botAuthByAddress[paymentAddress] = botAuthBody.token as string;
  }
  const primaryBot = signerBots[0];
  if (!primaryBot) {
    throw new Error("No signer bots were provisioned");
  }

  const { resolvePaymentKeyHash } = await import("@meshsdk/core");
  const paymentKeyHashes = signerAddresses.map((addr) => resolvePaymentKeyHash(addr));

  const createdWallets: Array<{
    type: CIWalletType;
    walletId: string;
    walletAddress: string;
    signerAddresses: string[];
  }> = [];

  for (const walletType of walletTypes) {
    const basePayload: Record<string, unknown> = {
      name: `CI ${walletType} Wallet ${Date.now()}`,
      description: `CI ${walletType} wallet smoke test`,
      signersAddresses: signerAddresses,
      signersDescriptions: ["CI Signer 1", "CI Signer 2", "CI Signer 3"],
      numRequiredSigners: Math.min(requiredSigners, signerAddresses.length),
      scriptType: "atLeast",
      network: networkId,
    };

    if (walletType === "hierarchical") {
      basePayload.scriptType = "all";
      basePayload.paymentNativeScript = {
        type: "all",
        scripts: [
          {
            type: "atLeast",
            required: Math.min(requiredSigners, paymentKeyHashes.length),
            scripts: paymentKeyHashes.map((keyHash) => ({ type: "sig", keyHash })),
          },
        ],
      } satisfies PaymentNativeScript;
    }

    if (walletType === "sdk") {
      basePayload.signersDRepKeys = paymentKeyHashes;
    }

    const createWalletResponse = await fetch(`${apiBaseUrl}/api/v1/createWallet`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${botAuthByAddress[primaryBot.paymentAddress]}`,
      },
      body: JSON.stringify(basePayload),
    });
    const createWalletBody = await createWalletResponse.json();
    if (!createWalletResponse.ok || !createWalletBody?.walletId) {
      throw new Error(
        `createWallet (${walletType}) failed (${createWalletResponse.status}): ${stringifyRedacted(createWalletBody)}`,
      );
    }

    for (const bot of signerBots.slice(1)) {
      await prisma.walletBotAccess.upsert({
        where: {
          walletId_botId: {
            walletId: createWalletBody.walletId as string,
            botId: bot.botId,
          },
        },
        update: {
          role: BotWalletRole.cosigner,
        },
        create: {
          walletId: createWalletBody.walletId as string,
          botId: bot.botId,
          role: BotWalletRole.cosigner,
        },
      });
    }

    createdWallets.push({
      type: walletType,
      walletId: createWalletBody.walletId as string,
      walletAddress: createWalletBody.address as string,
      signerAddresses,
    });
  }

  await import("fs/promises").then((fs) =>
    fs.writeFile(
      contextPath,
      JSON.stringify(
        {
          schemaVersion: 2,
          createdAt: new Date().toISOString(),
          apiBaseUrl,
          networkId,
          walletTypes,
          wallets: createdWallets,
          bots: signerBots,
          defaultBotId: primaryBot.id,
          walletId: createdWallets[0]?.walletId,
          walletAddress: createdWallets[0]?.walletAddress,
          signerAddresses,
        },
        null,
        2,
      ),
      "utf8",
    ),
  );

  console.log(
    `Created wallets: ${createdWallets.map((w) => `${w.type}:${w.walletId}`).join(", ")}`,
  );
  console.log(`Saved CI context to ${contextPath}`);
}

main()
  .catch((error) => {
    console.error("create-wallets failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

