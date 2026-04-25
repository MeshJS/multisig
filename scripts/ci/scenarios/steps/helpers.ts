import type { CIBootstrapContext, CIWalletType } from "../../framework/types";

export function getWalletByType(ctx: CIBootstrapContext, typeRaw: string) {
  const type = typeRaw.trim().toLowerCase();
  return ctx.wallets.find((w) => w.type === type);
}

export function getRingWalletTypes(ctx: CIBootstrapContext): [CIWalletType, CIWalletType, CIWalletType] {
  const expected: CIWalletType[] = ["legacy", "hierarchical", "sdk"];
  const missing = expected.filter((walletType) => !ctx.wallets.some((wallet) => wallet.type === walletType));
  if (missing.length) {
    throw new Error(
      `Ring transfer scenario requires wallet types: legacy,hierarchical,sdk; missing: ${missing.join(", ")}`,
    );
  }
  return ["legacy", "hierarchical", "sdk"];
}
