import { createHmac } from "crypto";
import type { CIBootstrapContext, CIBotContext } from "./types";
import { requestJson } from "./http";

type CachedBotToken = {
  token: string;
  expiresAtMs: number;
};

const botTokenCache = new Map<string, CachedBotToken>();
const BOT_AUTH_RETRY_DELAYS_MS = [250, 500, 1000] as const;

export function requireCiJwtSecret(): string {
  const value = process.env.CI_JWT_SECRET;
  if (!value || !value.trim()) {
    throw new Error("Missing required environment variable: CI_JWT_SECRET");
  }
  return value.trim();
}

// Deterministic secret lets us re-auth bots without persisting secrets to disk.
export function deriveCiBotSecret(paymentAddress: string, jwtSecret: string): string {
  return createHmac("sha256", jwtSecret)
    .update(`ci-bot-secret:${paymentAddress}`, "utf8")
    .digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeJwtExpiryMs(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    if (typeof decoded.exp !== "number" || !Number.isFinite(decoded.exp)) return null;
    return decoded.exp * 1000;
  } catch {
    return null;
  }
}

function getBotCacheKey(bot: CIBotContext): string {
  return `${bot.id}:${bot.paymentAddress}`;
}

export async function authenticateBot(args: {
  ctx: CIBootstrapContext;
  bot: CIBotContext;
}): Promise<string> {
  const cacheKey = getBotCacheKey(args.bot);
  const now = Date.now();
  const cacheHit = botTokenCache.get(cacheKey);
  if (cacheHit && cacheHit.expiresAtMs - now > 10_000) {
    return cacheHit.token;
  }

  const secret = deriveCiBotSecret(args.bot.paymentAddress, requireCiJwtSecret());
  let auth: { status: number; data: { token?: string; error?: string } } | null = null;
  for (let attempt = 0; attempt <= BOT_AUTH_RETRY_DELAYS_MS.length; attempt++) {
    auth = await requestJson<{ token?: string; error?: string }>({
      url: `${args.ctx.apiBaseUrl}/api/v1/botAuth`,
      method: "POST",
      body: {
        botKeyId: args.bot.botKeyId,
        secret,
        paymentAddress: args.bot.paymentAddress,
      },
    });
    if (auth.status !== 429) {
      break;
    }
    if (attempt < BOT_AUTH_RETRY_DELAYS_MS.length) {
      await sleep(BOT_AUTH_RETRY_DELAYS_MS[attempt]);
    }
  }

  if (!auth || auth.status !== 200 || !auth.data?.token) {
    throw new Error(`botAuth failed (${auth.status})`);
  }

  const expiresAtMs = decodeJwtExpiryMs(auth.data.token) ?? Date.now() + 55 * 60 * 1000;
  botTokenCache.set(cacheKey, {
    token: auth.data.token,
    expiresAtMs,
  });

  return auth.data.token;
}
