import type { CIBootstrapContext, CIBotContext, CIWalletContext } from "./types";

export function getDefaultBot(ctx: CIBootstrapContext): CIBotContext {
  if (ctx.defaultBotId) {
    const matched = ctx.bots.find((bot) => bot.id === ctx.defaultBotId);
    if (matched) {
      return matched;
    }
  }

  const fallback = ctx.bots[0];
  if (!fallback) {
    throw new Error("Context has no bot credentials");
  }
  return fallback;
}

export function getBotForAddress(
  ctx: CIBootstrapContext,
  paymentAddress: string,
): CIBotContext {
  const address = paymentAddress.trim();
  const matched = ctx.bots.find((bot) => bot.paymentAddress === address);
  if (matched) {
    return matched;
  }
  throw new Error(`No bot context found for paymentAddress ${address}`);
}

export function getBotForSignerIndex(args: {
  ctx: CIBootstrapContext;
  wallet: CIWalletContext;
  signerIndex: number;
}): { bot: CIBotContext; signerAddress: string } {
  const signerAddress = args.wallet.signerAddresses[args.signerIndex];
  if (!signerAddress) {
    throw new Error(
      `Context is missing signerAddresses[${args.signerIndex}] for wallet ${args.wallet.walletId}`,
    );
  }

  return {
    bot: getBotForAddress(args.ctx, signerAddress),
    signerAddress,
  };
}
