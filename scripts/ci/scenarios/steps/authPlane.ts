import type { Scenario } from "../../framework/types";
import { requestJson } from "../../framework/http";
import { getDefaultBot } from "../../framework/botContext";
import { authenticateBot } from "../../framework/botAuth";
import { stringifyRedacted } from "../../framework/redact";
import { authenticateSignerWithMnemonic } from "../../framework/walletAuth";
import { getWalletByType } from "./helpers";

export function createScenarioAuthPlane(): Scenario {
  return {
    id: "scenario.auth-plane",
    description: "Wallet auth route checks and negative auth assertions",
    steps: [
      {
        id: "v1.authNegative.walletIds.addressMismatch",
        description: "Assert /api/v1/walletIds rejects mismatched address",
        severity: "critical",
        execute: async (ctx) => {
          const bot = getDefaultBot(ctx);
          const token = await authenticateBot({ ctx, bot });
          const mismatchAddress =
            ctx.bots.find((candidate) => candidate.id !== bot.id)?.paymentAddress ??
            `${bot.paymentAddress}x`;
          const response = await requestJson<{ error?: string }>({
            url: `${ctx.apiBaseUrl}/api/v1/walletIds?address=${encodeURIComponent(mismatchAddress)}`,
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
      {
        id: "v1.authNegative.addTransaction.addressMismatch",
        description: "Assert /api/v1/addTransaction rejects mismatched address",
        severity: "critical",
        execute: async (ctx) => {
          const bot = getDefaultBot(ctx);
          const token = await authenticateBot({ ctx, bot });
          const legacyWallet = getWalletByType(ctx, "legacy");
          if (!legacyWallet) {
            throw new Error("Missing legacy wallet for addTransaction negative check");
          }
          const mismatchAddress =
            ctx.bots.find((candidate) => candidate.id !== bot.id)?.paymentAddress ??
            `${bot.paymentAddress}x`;
          const response = await requestJson<{ error?: string }>({
            url: `${ctx.apiBaseUrl}/api/v1/addTransaction`,
            method: "POST",
            token,
            body: {
              walletId: legacyWallet.walletId,
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
            artifacts: { walletId: legacyWallet.walletId },
          };
        },
      },
      {
        id: "v1.authNegative.pendingTransactions.missingToken",
        description: "Assert /api/v1/pendingTransactions rejects missing token",
        severity: "critical",
        execute: async (ctx) => {
          const wallet = getWalletByType(ctx, "legacy") ?? ctx.wallets[0];
          if (!wallet) {
            throw new Error("No wallets available for pendingTransactions negative check");
          }
          const signerAddress = wallet.signerAddresses[0];
          if (!signerAddress) {
            throw new Error("Missing signer address for pendingTransactions negative check");
          }
          const response = await requestJson<{ error?: string }>({
            url: `${ctx.apiBaseUrl}/api/v1/pendingTransactions?walletId=${encodeURIComponent(wallet.walletId)}&address=${encodeURIComponent(signerAddress)}`,
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
      },
      {
        id: "v1.getNonce.authSigner.signer2",
        description: "Authenticate signer via getNonce + authSigner",
        severity: "critical",
        execute: async (ctx) => {
          const mnemonic = process.env.CI_MNEMONIC_2;
          if (!mnemonic?.trim()) {
            throw new Error("CI_MNEMONIC_2 is required for authSigner scenario");
          }
          const authResult = await authenticateSignerWithMnemonic({
            ctx,
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
    ],
  };
}
