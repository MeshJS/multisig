import type { PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";

type CallerDb = PrismaClient | Record<string, unknown>;

export type CallerContext = {
  db: CallerDb;
  session: Session | null;
  sessionAddress: string | null;
  sessionWallets: string[];
  primaryWallet: string | null;
  ip: string;
};

let ipCounter = 1;

function nextTestIp() {
  const value = ipCounter;
  ipCounter += 1;
  return `198.51.100.${value}`;
}

export function makeWalletCtx(
  signerAddress: string,
  db: CallerDb = undefined as unknown as CallerDb,
): CallerContext {
  return {
    db,
    session: null,
    sessionAddress: signerAddress,
    sessionWallets: [signerAddress],
    primaryWallet: signerAddress,
    ip: nextTestIp(),
  };
}

export function makeSessionCtx(
  userAddress: string,
  db: CallerDb = undefined as unknown as CallerDb,
): CallerContext {
  return {
    db,
    session: {
      user: { id: userAddress },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    } as Session,
    sessionAddress: userAddress,
    sessionWallets: [],
    primaryWallet: null,
    ip: nextTestIp(),
  };
}

export function makeAnonymousCtx(db: CallerDb = undefined as unknown as CallerDb): CallerContext {
  return {
    db,
    session: null,
    sessionAddress: null,
    sessionWallets: [],
    primaryWallet: null,
    ip: nextTestIp(),
  };
}
