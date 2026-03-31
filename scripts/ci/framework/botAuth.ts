import { createHmac } from "crypto";
import type { CIBootstrapContext, CIBotContext } from "./types";
import { requestJson } from "./http";

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

export async function authenticateBot(args: {
  ctx: CIBootstrapContext;
  bot: CIBotContext;
}): Promise<string> {
  const secret = deriveCiBotSecret(args.bot.paymentAddress, requireCiJwtSecret());
  const auth = await requestJson<{ token?: string; error?: string }>({
    url: `${args.ctx.apiBaseUrl}/api/v1/botAuth`,
    method: "POST",
    body: {
      botKeyId: args.bot.botKeyId,
      secret,
      paymentAddress: args.bot.paymentAddress,
    },
  });

  if (auth.status !== 200 || !auth.data?.token) {
    throw new Error(`botAuth failed (${auth.status})`);
  }

  return auth.data.token;
}
