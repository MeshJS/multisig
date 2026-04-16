import type { Scenario } from "../../framework/types";
import { requestJson } from "../../framework/http";
import { getDefaultBot } from "../../framework/botContext";
import { authenticateBot } from "../../framework/botAuth";
import { stringifyRedacted } from "../../framework/redact";

export function createScenarioBotIdentity(): Scenario {
  return {
    id: "scenario.bot-identity",
    description: "Bot profile route checks",
    steps: [
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
