import type { Context, ScenarioResult } from "./types";
import { botAuth } from "../../bot-ref/bot-client";
import { requireEnv } from "../lib/keys";

export async function botAuthScenario(ctx: Context): Promise<ScenarioResult> {
  const start = Date.now();
  try {
    const botKeyId = requireEnv("BOT_KEY_ID");
    const botSecret = requireEnv("BOT_SECRET");

    const { token, botId } = await botAuth({
      baseUrl: ctx.baseUrl,
      botKeyId,
      secret: botSecret,
      paymentAddress: ctx.botAddress,
    });

    if (!token || typeof token !== "string") {
      return {
        name: "bot-auth",
        passed: false,
        critical: true,
        message: "botAuth returned no token",
        durationMs: Date.now() - start,
      };
    }

    // Refresh token in context for downstream scenarios
    ctx.botToken = token;
    ctx.botId = botId;

    return {
      name: "bot-auth",
      passed: true,
      critical: true,
      message: `Authenticated as bot ${botId}`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "bot-auth",
      passed: false,
      critical: true,
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}
