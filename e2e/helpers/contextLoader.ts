import fs from "fs";

export type CIWalletType = "legacy" | "hierarchical" | "sdk";

export type CIWalletContext = {
  type: CIWalletType;
  walletId: string;
  walletAddress: string;
  transactionId?: string;
  signerAddresses: string[];
};

export type CIBootstrapContext = {
  schemaVersion: 3;
  createdAt: string;
  apiBaseUrl: string;
  networkId: 0 | 1;
  walletTypes: CIWalletType[];
  wallets: CIWalletContext[];
  signerAddresses: string[];
  signerStakeAddresses: string[];
  sdkStakeAddress?: string;
  stakePoolIdHex?: string;
};

export function loadContext(): CIBootstrapContext {
  const cached = process.env.CI_CONTEXT_JSON;
  if (cached) {
    return JSON.parse(cached) as CIBootstrapContext;
  }
  const contextPath = process.env.CI_CONTEXT_PATH;
  if (!contextPath) {
    throw new Error("CI_CONTEXT_PATH or CI_CONTEXT_JSON must be set");
  }
  return JSON.parse(fs.readFileSync(contextPath, "utf8")) as CIBootstrapContext;
}

export function getWallet(ctx: CIBootstrapContext, type: CIWalletType): CIWalletContext {
  const wallet = ctx.wallets.find((w) => w.type === type);
  if (!wallet) {
    throw new Error(`No ${type} wallet found in bootstrap context`);
  }
  return wallet;
}
