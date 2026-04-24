import type { Scenario } from "../../framework/types";
import { requestJson } from "../../framework/http";
import { getDefaultBot } from "../../framework/botContext";
import { authenticateBot, deriveCiBotSecret, requireCiJwtSecret } from "../../framework/botAuth";
import { stringifyRedacted } from "../../framework/redact";

export function createScenarioBotIdentity(): Scenario {
  return {
    id: "scenario.bot-identity",
    description: "Bot profile route checks",
    steps: [
      {
        id: "v1.botAuth.explicitRouteCheck",
        description: "Verify /api/v1/botAuth response shape directly (bypasses token cache)",
        severity: "critical",
        execute: async (ctx) => {
          const bot = getDefaultBot(ctx);
          const secret = deriveCiBotSecret(bot.paymentAddress, requireCiJwtSecret());
          const response = await requestJson<{ token?: string; error?: string }>({
            url: `${ctx.apiBaseUrl}/api/v1/botAuth`,
            method: "POST",
            body: {
              botKeyId: bot.botKeyId,
              secret,
              paymentAddress: bot.paymentAddress,
            },
          });
          if (response.status !== 200 || typeof response.data?.token !== "string") {
            throw new Error(
              `botAuth explicit check failed (${response.status}): ${stringifyRedacted(response.data)}`,
            );
          }
          const parts = response.data.token.split(".");
          if (parts.length !== 3) {
            throw new Error(
              `botAuth: token is not a valid JWT — expected 3 dot-separated segments, got ${parts.length}`,
            );
          }
          return {
            message: "botAuth explicit route check passed: response contains a well-formed JWT",
            artifacts: { jwtSegmentCount: parts.length },
          };
        },
      },
      {
        id: "v1.botMe.defaultBot",
        description: "Verify default bot identity via /api/v1/botMe",
        severity: "critical",
        execute: async (ctx) => {
          const bot = getDefaultBot(ctx);
          const token = await authenticateBot({ ctx, bot });
          const response = await requestJson<{
            botId?: string;
            paymentAddress?: string;
            ownerAddress?: string;
            error?: string;
          }>({
            url: `${ctx.apiBaseUrl}/api/v1/botMe`,
            method: "GET",
            token,
          });
          if (response.status !== 200) {
            throw new Error(`botMe failed (${response.status}): ${stringifyRedacted(response.data)}`);
          }
          if (response.data.botId !== bot.botId) {
            throw new Error("botMe returned unexpected botId");
          }
          if (response.data.paymentAddress !== bot.paymentAddress) {
            throw new Error("botMe returned unexpected paymentAddress");
          }
          return {
            message: `botMe resolved bot ${response.data.botId}`,
            artifacts: {
              botId: response.data.botId,
              paymentAddress: response.data.paymentAddress,
            },
          };
        },
      },
    ],
  };
}
