import { randomUUID } from "crypto";
import type { PrismaClient } from "@prisma/client";

type DbClient = PrismaClient;

export async function seedWallet(db: DbClient, signerAddress: string): Promise<{ walletId: string }> {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const wallet = await db.wallet.create({
    data: {
      name: `trpc-wallet-${suffix}`,
      description: `tRPC test wallet ${suffix}`,
      signersAddresses: [signerAddress],
      signersStakeKeys: [],
      signersDRepKeys: [],
      signersDescriptions: [""],
      numRequiredSigners: 1,
      verified: [],
      scriptCbor: "deadbeef",
      stakeCredentialHash: null,
      type: "atLeast",
      ownerAddress: signerAddress,
    },
  });

  return { walletId: wallet.id };
}

export async function seedUser(db: DbClient, address: string): Promise<{ userId: string }> {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const user = await db.user.create({
    data: {
      address,
      stakeAddress: `stake_test_${suffix}`,
      nostrKey: `nostr_${suffix}`,
    },
  });

  return { userId: user.id };
}

export async function cleanupFixtures(
  db: DbClient,
  ids: { walletId?: string; userId?: string },
): Promise<void> {
  try {
    if (ids.walletId) {
      await db.transaction.deleteMany({ where: { walletId: ids.walletId } });
      await db.proxy.deleteMany({ where: { walletId: ids.walletId } });
      await db.walletBotAccess.deleteMany({ where: { walletId: ids.walletId } });
    }

    if (ids.userId) {
      await db.proxy.deleteMany({ where: { userId: ids.userId } });
    }

    if (ids.walletId) {
      await db.wallet.deleteMany({ where: { id: ids.walletId } });
    }

    if (ids.userId) {
      await db.user.deleteMany({ where: { id: ids.userId } });
    }
  } catch {
    // Cleanup should not mask the original test failure.
  }
}
