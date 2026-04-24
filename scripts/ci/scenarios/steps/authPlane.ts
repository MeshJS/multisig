import type { CIBootstrapContext, CIBotContext, Scenario } from "../../framework/types";
import { requestJson } from "../../framework/http";
import { getDefaultBot } from "../../framework/botContext";
import { authenticateBot } from "../../framework/botAuth";
import { stringifyRedacted } from "../../framework/redact";
import { authenticateSignerWithMnemonic } from "../../framework/walletAuth";
import { getWalletByType } from "./helpers";

export function createScenarioAuthPlane(ctx: CIBootstrapContext): Scenario {
  return {
    id: "scenario.auth-plane",
    description: "Wallet auth route checks and negative auth assertions",
    steps: [
      {
        id: "v1.authNegative.walletIds.addressMismatch",
        description: "Assert /api/v1/walletIds rejects mismatched address",
        severity: "critical",
        execute: async (runCtx) => {
          const bot = getDefaultBot(runCtx);
          const token = await authenticateBot({ ctx: runCtx, bot });
          const mismatchAddress =
            runCtx.bots.find((candidate) => candidate.id !== bot.id)?.paymentAddress ??
            `${bot.paymentAddress}x`;
          const response = await requestJson<{ error?: string }>({
            url: `${runCtx.apiBaseUrl}/api/v1/walletIds?address=${encodeURIComponent(mismatchAddress)}`,
            method: "GET",
            token,
          });
          if (response.status !== 403) {
            throw new Error(
              `walletIds address mismatch expected 403, got ${response.status}: ${stringifyRedacted(response.data)}`,
            );
          }
          return {
            message: "walletIds address mismatch correctly rejected with 403",
          };
        },
      },
      ...ctx.walletTypes.map((walletType) => ({
        id: `v1.authNegative.addTransaction.addressMismatch.${walletType}`,
        description: `Assert /api/v1/addTransaction rejects mismatched address (${walletType} walletId)`,
        severity: "critical" as const,
        execute: async (runCtx: CIBootstrapContext) => {
          const bot = getDefaultBot(runCtx);
          const token = await authenticateBot({ ctx: runCtx, bot });
          const targetWallet = getWalletByType(runCtx, walletType);
          if (!targetWallet) {
            throw new Error(`Missing ${walletType} wallet for addTransaction negative check`);
          }
          const mismatchAddress =
            runCtx.bots.find((candidate: CIBotContext) => candidate.id !== bot.id)?.paymentAddress ??
            `${bot.paymentAddress}x`;
          const response = await requestJson<{ error?: string }>({
            url: `${runCtx.apiBaseUrl}/api/v1/addTransaction`,
            method: "POST",
            token,
            body: {
              walletId: targetWallet.walletId,
              address: mismatchAddress,
              txCbor: "00",
              txJson: "{}",
              description: "CI address mismatch negative check",
            },
          });
          if (response.status !== 403) {
            throw new Error(
              `addTransaction address mismatch expected 403, got ${response.status}: ${stringifyRedacted(response.data)}`,
            );
          }
          return {
            message: "addTransaction address mismatch correctly rejected with 403",
            artifacts: { walletId: targetWallet.walletId },
          };
        },
      })),
      ...ctx.walletTypes.map((walletType) => ({
        id: `v1.authNegative.pendingTransactions.missingToken.${walletType}`,
        description: `Assert /api/v1/pendingTransactions rejects missing token (${walletType} wallet)`,
        severity: "critical" as const,
        execute: async (runCtx: CIBootstrapContext) => {
          const wallet = getWalletByType(runCtx, walletType);
          if (!wallet) {
            throw new Error(`Missing ${walletType} wallet for pendingTransactions negative check`);
          }
          const signerAddress = wallet.signerAddresses[0];
          if (!signerAddress) {
            throw new Error("Missing signer address for pendingTransactions negative check");
          }
          const response = await requestJson<{ error?: string }>({
            url: `${runCtx.apiBaseUrl}/api/v1/pendingTransactions?walletId=${encodeURIComponent(wallet.walletId)}&address=${encodeURIComponent(signerAddress)}`,
            method: "GET",
          });
          if (response.status !== 401) {
            throw new Error(
              `pendingTransactions missing token expected 401, got ${response.status}: ${stringifyRedacted(response.data)}`,
            );
          }
          return {
            message: "pendingTransactions missing token correctly rejected with 401",
            artifacts: { walletId: wallet.walletId },
          };
        },
      })),
      {
        id: "v1.authNegative.drepInfo.missingToken",
        description: "Assert /api/v1/drepInfo rejects missing token with 401",
        severity: "critical",
        execute: async (runCtx) => {
          const wallet = runCtx.wallets[0];
          if (!wallet) {
            throw new Error("drepInfo negative check: no wallet in context");
          }
          const signerAddress = wallet.signerAddresses[0] ?? "";
          const response = await requestJson<{ error?: string }>({
            url: `${runCtx.apiBaseUrl}/api/v1/drepInfo?walletId=${encodeURIComponent(wallet.walletId)}&address=${encodeURIComponent(signerAddress)}`,
            method: "GET",
          });
          if (response.status !== 401) {
            throw new Error(
              `drepInfo missing token expected 401, got ${response.status}: ${stringifyRedacted(response.data)}`,
            );
          }
          return {
            message: "drepInfo missing token correctly rejected with 401",
          };
        },
      },
      {
        id: "v1.authNegative.stakeAccountInfo.missingToken",
        description: "Assert /api/v1/stakeAccountInfo rejects missing token with 401",
        severity: "critical",
        execute: async (runCtx) => {
          const stakeAddress = runCtx.signerStakeAddresses[0] ?? runCtx.sdkStakeAddress ?? "stake_test1abc";
          const response = await requestJson<{ error?: string }>({
            url: `${runCtx.apiBaseUrl}/api/v1/stakeAccountInfo?stakeAddress=${encodeURIComponent(stakeAddress)}`,
            method: "GET",
          });
          if (response.status !== 401) {
            throw new Error(
              `stakeAccountInfo missing token expected 401, got ${response.status}: ${stringifyRedacted(response.data)}`,
            );
          }
          return {
            message: "stakeAccountInfo missing token correctly rejected with 401",
          };
        },
      },
      {
        id: "v1.authNegative.createWallet.missingToken",
        description: "Assert /api/v1/createWallet rejects missing token with 401",
        severity: "critical",
        execute: async (runCtx) => {
          const response = await requestJson<{ error?: string }>({
            url: `${runCtx.apiBaseUrl}/api/v1/createWallet`,
            method: "POST",
            body: { name: "should-be-rejected", signersAddresses: [] },
          });
          if (response.status !== 401) {
            throw new Error(
              `createWallet missing token expected 401, got ${response.status}: ${stringifyRedacted(response.data)}`,
            );
          }
          return {
            message: "createWallet missing token correctly rejected with 401",
          };
        },
      },
      {
        id: "v1.getNonce.authSigner.signer2",
        description: "Authenticate signer via getNonce + authSigner",
        severity: "critical",
        execute: async (runCtx) => {
          const mnemonic = process.env.CI_MNEMONIC_2;
          if (!mnemonic?.trim()) {
            throw new Error("CI_MNEMONIC_2 is required for authSigner scenario");
          }
          const authResult = await authenticateSignerWithMnemonic({
            ctx: runCtx,
            mnemonic,
          });
          return {
            message: "Signer wallet auth succeeded through getNonce/authSigner",
            artifacts: {
              signerAddress: authResult.signerAddress,
              nonceLength: authResult.nonce.length,
            },
          };
        },
      },
      {
        id: "v1.signTransaction.badTransactionId",
        description: "Assert /api/v1/signTransaction returns 404 for a non-existent transactionId",
        severity: "non-critical",
        execute: async (runCtx) => {
          const mnemonic = process.env.CI_MNEMONIC_2;
          if (!mnemonic?.trim()) {
            return {
              message: "CI_MNEMONIC_2 not set; skipping signTransaction bad-id validation check",
              artifacts: { skipped: true },
            };
          }
          const wallet = getWalletByType(runCtx, runCtx.walletTypes[0] ?? "legacy");
          if (!wallet) {
            throw new Error("signTransaction bad-id: no wallet in context");
          }
          const authResult = await authenticateSignerWithMnemonic({ ctx: runCtx, mnemonic });
          const response = await requestJson<{ error?: string }>({
            url: `${runCtx.apiBaseUrl}/api/v1/signTransaction`,
            method: "POST",
            token: authResult.token,
            body: {
              walletId: wallet.walletId,
              transactionId: "00000000-0000-0000-0000-000000000000",
              address: authResult.signerAddress,
              signature: "aabbccdd",
              key: "eeff0011",
              broadcast: false,
            },
          });
          if (response.status !== 404) {
            throw new Error(
              `signTransaction bad transactionId expected 404, got ${response.status}: ${stringifyRedacted(response.data)}`,
            );
          }
          return {
            message: "signTransaction non-existent transactionId correctly returns 404",
            artifacts: { walletId: wallet.walletId },
          };
        },
      },
    ],
  };
}
