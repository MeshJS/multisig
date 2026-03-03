/**
 * Reference bot client for the multisig v1 API.
 * Load config from BOT_CONFIG (JSON string), BOT_CONFIG_PATH (file path), or bot-config.json in cwd.
 * Used by Cursor agent and local scripts to test bot flows.
 *
 * Usage:
 *   BOT_CONFIG='{"baseUrl":"http://localhost:3000","botKeyId":"...","secret":"...","paymentAddress":"addr1_..."}' npx tsx bot-client.ts auth
 *   npx tsx bot-client.ts walletIds
 *   npx tsx bot-client.ts pendingTransactions <walletId>
 */

export type BotConfig = {
  baseUrl: string;
  botKeyId: string;
  secret: string;
  paymentAddress: string;
};

export async function loadConfig(): Promise<BotConfig> {
  const fromEnv = process.env.BOT_CONFIG;
  if (fromEnv) {
    try {
      return JSON.parse(fromEnv) as BotConfig;
    } catch (e) {
      throw new Error("BOT_CONFIG is invalid JSON: " + (e as Error).message);
    }
  }
  const path = process.env.BOT_CONFIG_PATH ?? "bot-config.json";
  const { readFileSync } = await import("fs");
  const { join } = await import("path");
  const fullPath = path.startsWith("/") ? path : join(process.cwd(), path);
  try {
    const raw = readFileSync(fullPath, "utf8");
    return JSON.parse(raw) as BotConfig;
  } catch (e) {
    throw new Error(`Failed to load config from ${path}: ${(e as Error).message}`);
  }
}

function ensureSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** Authenticate with bot key + payment address; returns JWT. */
export async function botAuth(config: BotConfig): Promise<{ token: string; botId: string }> {
  const base = ensureSlash(config.baseUrl);
  const res = await fetch(`${base}/api/v1/botAuth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      botKeyId: config.botKeyId,
      secret: config.secret,
      paymentAddress: config.paymentAddress,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`botAuth failed ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { token: string; botId: string };
  return { token: data.token, botId: data.botId };
}

/** Get wallet IDs for the bot (requires prior auth; pass JWT). */
export async function getWalletIds(baseUrl: string, token: string, address: string): Promise<{ walletId: string; walletName: string }[]> {
  const base = ensureSlash(baseUrl);
  const res = await fetch(`${base}/api/v1/walletIds?address=${encodeURIComponent(address)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`walletIds failed ${res.status}: ${await res.text()}`);
  return (await res.json()) as { walletId: string; walletName: string }[];
}

/** Get pending transactions for a wallet. */
export async function getPendingTransactions(
  baseUrl: string,
  token: string,
  walletId: string,
  address: string,
): Promise<unknown[]> {
  const base = ensureSlash(baseUrl);
  const res = await fetch(
    `${base}/api/v1/pendingTransactions?walletId=${encodeURIComponent(walletId)}&address=${encodeURIComponent(address)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`pendingTransactions failed ${res.status}: ${await res.text()}`);
  return (await res.json()) as unknown[];
}

/** Get free UTxOs for a wallet. */
export async function getFreeUtxos(
  baseUrl: string,
  token: string,
  walletId: string,
  address: string,
): Promise<unknown[]> {
  const base = ensureSlash(baseUrl);
  const res = await fetch(
    `${base}/api/v1/freeUtxos?walletId=${encodeURIComponent(walletId)}&address=${encodeURIComponent(address)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`freeUtxos failed ${res.status}: ${await res.text()}`);
  return (await res.json()) as unknown[];
}

/** Get the bot's own info including owner's address (bot JWT only). */
export async function getBotMe(
  baseUrl: string,
  token: string,
): Promise<{
  botId: string;
  paymentAddress: string;
  displayName: string | null;
  botName: string;
  ownerAddress: string;
}> {
  const base = ensureSlash(baseUrl);
  const res = await fetch(`${base}/api/v1/botMe`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`botMe failed ${res.status}: ${await res.text()}`);
  return (await res.json()) as {
    botId: string;
    paymentAddress: string;
    displayName: string | null;
    botName: string;
    ownerAddress: string;
  };
}

/** Get owner info for a wallet (requires access). */
export async function getOwnerInfo(
  baseUrl: string,
  token: string,
  walletId: string,
): Promise<{
  ownerAddress: string | null;
  type: "user" | "bot" | "all" | null;
  user: { address: string; stakeAddress: string } | null;
  bot: { botId: string; paymentAddress: string; displayName: string | null; botName: string } | null;
}> {
  const base = ensureSlash(baseUrl);
  const res = await fetch(
    `${base}/api/v1/ownerInfo?walletId=${encodeURIComponent(walletId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`ownerInfo failed ${res.status}: ${await res.text()}`);
  return (await res.json()) as {
    ownerAddress: string | null;
    type: "user" | "bot" | "all" | null;
    user: { address: string; stakeAddress: string } | null;
    bot: { botId: string; paymentAddress: string; displayName: string | null; botName: string } | null;
  };
}

/** Create a new multisig wallet (bot must have multisig:create scope). */
export async function createWallet(
  baseUrl: string,
  token: string,
  body: {
    name: string;
    description?: string;
    signersAddresses: string[];
    signersDescriptions?: string[];
    signersStakeKeys?: (string | null)[];
    signersDRepKeys?: (string | null)[];
    numRequiredSigners?: number;
    scriptType?: "atLeast" | "all" | "any";
    stakeCredentialHash?: string;
    network?: number;
  },
): Promise<{ walletId: string; address: string; name: string }> {
  const base = ensureSlash(baseUrl);
  const res = await fetch(`${base}/api/v1/createWallet`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createWallet failed ${res.status}: ${text}`);
  }
  return (await res.json()) as { walletId: string; address: string; name: string };
}

async function main() {
  const config = await loadConfig();
  const cmd = process.argv[2];
  if (!cmd) {
    console.error("Usage: bot-client.ts <auth|walletIds|pendingTransactions|freeUtxos|ownerInfo|createWallet> [args]");
    console.error("  auth                 - register/login and print token");
    console.error("  walletIds            - list wallet IDs (requires auth first; set BOT_TOKEN)");
    console.error("  pendingTransactions <walletId>");
    console.error("  freeUtxos <walletId>");
    console.error("  ownerInfo <walletId> - get wallet owner info");
    console.error("  botMe               - get bot's own info (incl. owner address)");
    console.error("  createWallet [file]   - create wallet via API (body from file or stdin); bot needs multisig:create");
    console.error("Env: BOT_CONFIG (JSON), BOT_CONFIG_PATH, BOT_TOKEN (after auth).");
    process.exit(1);
  }

  if (cmd === "auth") {
    if (!config.paymentAddress) {
      console.error("paymentAddress is required in config for auth.");
      process.exit(1);
    }
    const { token, botId } = await botAuth(config);
    console.log(JSON.stringify({ token, botId }, null, 2));
    console.error("Set BOT_TOKEN to the token above for subsequent calls.");
    return;
  }

  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error("BOT_TOKEN required. Run 'auth' first and set BOT_TOKEN.");
    process.exit(1);
  }

  if (cmd === "botMe") {
    const info = await getBotMe(config.baseUrl, token);
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  const address = config.paymentAddress;
  if (!address) {
    console.error("paymentAddress required in config.");
    process.exit(1);
  }

  switch (cmd) {
    case "walletIds": {
      const list = await getWalletIds(config.baseUrl, token, address);
      console.log(JSON.stringify(list, null, 2));
      break;
    }
    case "pendingTransactions": {
      const walletId = process.argv[3];
      if (!walletId) {
        console.error("Usage: bot-client.ts pendingTransactions <walletId>");
        process.exit(1);
      }
      const list = await getPendingTransactions(config.baseUrl, token, walletId, address);
      console.log(JSON.stringify(list, null, 2));
      break;
    }
    case "freeUtxos": {
      const walletId = process.argv[3];
      if (!walletId) {
        console.error("Usage: bot-client.ts freeUtxos <walletId>");
        process.exit(1);
      }
      const list = await getFreeUtxos(config.baseUrl, token, walletId, address);
      console.log(JSON.stringify(list, null, 2));
      break;
    }
    case "ownerInfo": {
      const walletId = process.argv[3];
      if (!walletId) {
        console.error("Usage: bot-client.ts ownerInfo <walletId>");
        process.exit(1);
      }
      const info = await getOwnerInfo(config.baseUrl, token, walletId);
      console.log(JSON.stringify(info, null, 2));
      break;
    }
    case "createWallet": {
      const fileArg = process.argv[3];
      let raw: string;
      if (fileArg) {
        const { readFileSync } = await import("fs");
        const { join } = await import("path");
        raw = readFileSync(fileArg.startsWith("/") ? fileArg : join(process.cwd(), fileArg), "utf8");
      } else {
        const { createInterface } = await import("readline");
        const rl = createInterface({ input: process.stdin, terminal: false });
        const lines: string[] = [];
        for await (const line of rl) lines.push(line);
        raw = lines.join("\n");
      }
      const body = JSON.parse(raw) as { name: string; signersAddresses: string[]; [k: string]: unknown };
      if (!body.name || !Array.isArray(body.signersAddresses) || body.signersAddresses.length === 0) {
        console.error("Body must have name (string) and signersAddresses (non-empty string array).");
        process.exit(1);
      }
      const result = await createWallet(config.baseUrl, token, {
        name: body.name,
        description: body.description as string | undefined,
        signersAddresses: body.signersAddresses,
        signersDescriptions: body.signersDescriptions as string[] | undefined,
        signersStakeKeys: body.signersStakeKeys as (string | null)[] | undefined,
        signersDRepKeys: body.signersDRepKeys as (string | null)[] | undefined,
        numRequiredSigners: body.numRequiredSigners as number | undefined,
        scriptType: body.scriptType as "atLeast" | "all" | "any" | undefined,
        stakeCredentialHash: body.stakeCredentialHash as string | undefined,
        network: body.network as number | undefined,
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      console.error("Unknown command:", cmd);
      process.exit(1);
  }
}

if (process.argv[1]?.includes("bot-client")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
