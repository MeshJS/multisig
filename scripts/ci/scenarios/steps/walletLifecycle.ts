import type { CIBootstrapContext, Scenario } from "../../framework/types";
import { requestJson } from "../../framework/http";
import { getDefaultBot } from "../../framework/botContext";
import { authenticateBot } from "../../framework/botAuth";
import { stringifyRedacted } from "../../framework/redact";

export function createScenarioCreateWallet(ctx: CIBootstrapContext): Scenario {
  const runtime: { createdWalletId?: string } = {};
  return {
    id: "scenario.create-wallet",
    description: "Verify POST /api/v1/createWallet creates a wallet via the bot API",
    steps: [
      {
        id: "v1.createWallet.botCreate",
        description: "Create a new multisig wallet via /api/v1/createWallet (bot-authenticated)",
        severity: "critical",
        execute: async (runCtx) => {
          const bot = getDefaultBot(runCtx);
          const token = await authenticateBot({ ctx: runCtx, bot });
          const signerAddresses = runCtx.signerAddresses.slice(0, 3).filter(Boolean);
          if (signerAddresses.length < 1) {
            throw new Error("createWallet: no signer addresses in bootstrap context");
          }
          const numRequiredSigners = Math.min(
            parseInt(process.env.CI_NUM_REQUIRED_SIGNERS ?? "2", 10),
            signerAddresses.length,
          );
          const response = await requestJson<{
            walletId?: string;
            address?: string;
            name?: string;
            error?: string;
          }>({
            url: `${runCtx.apiBaseUrl}/api/v1/createWallet`,
            method: "POST",
            token,
            body: {
              name: `CI create-wallet ${runCtx.createdAt}`,
              signersAddresses: signerAddresses,
              numRequiredSigners,
              scriptType: "atLeast",
              network: runCtx.networkId,
            },
          });
          if (response.status !== 201) {
            throw new Error(
              `createWallet expected 201, got ${response.status}: ${stringifyRedacted(response.data)}`,
            );
          }
          if (typeof response.data.walletId !== "string" || !response.data.walletId) {
            throw new Error("createWallet: response missing walletId");
          }
          if (typeof response.data.address !== "string" || !response.data.address) {
            throw new Error("createWallet: response missing address");
          }
          runtime.createdWalletId = response.data.walletId;
          return {
            message: `createWallet succeeded: walletId=${response.data.walletId}`,
            artifacts: {
              walletId: response.data.walletId,
              address: response.data.address,
              name: response.data.name,
            },
          };
        },
      },
      {
        id: "v1.createWallet.appearsInWalletIds",
        description: "Confirm created wallet appears in /api/v1/walletIds for the bot",
        severity: "critical",
        execute: async (runCtx) => {
          if (!runtime.createdWalletId) {
            throw new Error("createWallet.appearsInWalletIds: no walletId from prior step");
          }
          const bot = getDefaultBot(runCtx);
          const token = await authenticateBot({ ctx: runCtx, bot });
          const response = await requestJson<Array<{ walletId?: string }> | { error?: string }>({
            url: `${runCtx.apiBaseUrl}/api/v1/walletIds?address=${encodeURIComponent(bot.paymentAddress)}`,
            method: "GET",
            token,
          });
          if (response.status !== 200 || !Array.isArray(response.data)) {
            throw new Error(
              `walletIds check after createWallet failed (${response.status}): ${stringifyRedacted(response.data)}`,
            );
          }
          const found = response.data.some(
            (w) => w.walletId === runtime.createdWalletId,
          );
          if (!found) {
            throw new Error(
              `createWallet: walletId ${runtime.createdWalletId} not found in walletIds after creation`,
            );
          }
          return {
            message: `Created wallet ${runtime.createdWalletId} confirmed in walletIds`,
            artifacts: {
              walletId: runtime.createdWalletId,
              totalWallets: response.data.length,
            },
          };
        },
      },
    ],
  };
}
