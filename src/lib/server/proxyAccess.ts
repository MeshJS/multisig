import type { PrismaClient, Proxy, Wallet } from "@prisma/client";
import type { JwtPayload } from "@/lib/verifyJwt";
import { isBotJwt } from "@/lib/verifyJwt";
import { getBotWalletAccess } from "@/lib/auth/botAccess";

export async function authorizeProxyReadForV1(args: {
  db: PrismaClient;
  payload: JwtPayload;
  walletId: string;
  address: string;
}): Promise<{ wallet: Wallet }> {
  const { db, payload, walletId, address } = args;
  if (payload.address !== address) {
    throw Object.assign(new Error("Address mismatch"), {
      code: "ADDRESS_MISMATCH",
    });
  }

  const wallet = await db.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) {
    throw Object.assign(new Error("Wallet not found"), { code: "NOT_FOUND" });
  }

  if (isBotJwt(payload)) {
    const access = await getBotWalletAccess(db, walletId, payload.botId);
    if (!access.allowed) {
      throw Object.assign(new Error("Not authorized for this wallet"), {
        code: "FORBIDDEN",
      });
    }
    return { wallet };
  }

  if (!wallet.signersAddresses.includes(address)) {
    throw Object.assign(new Error("Not authorized for this wallet"), {
      code: "FORBIDDEN",
    });
  }

  return { wallet };
}

export async function loadActiveProxyForWallet(args: {
  db: PrismaClient;
  walletId: string;
  proxyId: string;
}): Promise<Proxy> {
  const proxy = await args.db.proxy.findFirst({
    where: {
      id: args.proxyId,
      walletId: args.walletId,
      isActive: true,
    },
  });

  if (!proxy) {
    throw Object.assign(new Error("Active proxy not found for this wallet"), {
      code: "NOT_FOUND",
    });
  }

  return proxy;
}
