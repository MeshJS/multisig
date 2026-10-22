import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { TRPCError } from "@trpc/server";

import { createCaller } from "@/server/api/root";

// A Cardano address is public; the Discord account or Nostr key someone linked
// to it is not. These specs pin who may read which.

const ALICE = "addr_test1qalice";
const BOB = "addr_test1qbob";

const aliceRow = {
  id: "user-alice",
  address: ALICE,
  stakeAddress: "stake_test1ualice",
  drepKeyHash: "drep-alice",
  nostrKey: "npub-alice",
  discordId: "111111111111111111",
};

const db = {
  user: { findUnique: jest.fn<(args: any) => Promise<any>>() },
};

// Mimics Prisma's `select`: returns only the selected columns, so a test can
// tell what the query asked the database for, not just what came back.
db.user.findUnique.mockImplementation(async (args: any) => {
  if (args.where.address !== ALICE) return null;
  if (!args.select) return { ...aliceRow };
  return Object.fromEntries(
    Object.keys(args.select)
      .filter((key) => args.select[key])
      .map((key) => [key, (aliceRow as Record<string, unknown>)[key]]),
  );
});

const anonymous = () =>
  createCaller({
    db: db as any,
    session: null,
    sessionAddress: null,
    sessionWallets: [],
    primaryWallet: null,
    ip: "203.0.113.1",
  });

const walletSession = (primary: string, wallets: string[] = [primary]) =>
  createCaller({
    db: db as any,
    session: null,
    sessionAddress: primary,
    sessionWallets: wallets,
    primaryWallet: primary,
    ip: "203.0.113.2",
  });

const nextAuthSession = (address: string) =>
  createCaller({
    db: db as any,
    session: { user: { id: address }, expires: new Date(Date.now() + 60_000).toISOString() } as any,
    sessionAddress: address,
    sessionWallets: [],
    primaryWallet: null,
    ip: "203.0.113.3",
  });

beforeEach(() => {
  db.user.findUnique.mockClear();
});

describe("user.getUserByAddress", () => {
  it("gives an anonymous caller only the on-chain columns", async () => {
    const user = await anonymous().user.getUserByAddress({ address: ALICE });

    expect(user).toEqual({
      id: "user-alice",
      address: ALICE,
      stakeAddress: "stake_test1ualice",
      drepKeyHash: "drep-alice",
      discordId: "",
      nostrKey: null,
    });
  });

  it("asks the database for an allowlist, so a new private column stays private", async () => {
    await anonymous().user.getUserByAddress({ address: ALICE });

    const args = db.user.findUnique.mock.calls[0]![0];
    expect(Object.keys(args.select).sort()).toEqual(
      ["address", "drepKeyHash", "id", "stakeAddress"],
    );
  });

  it("does not show another signed-in user someone else's Discord account", async () => {
    const user = await walletSession(BOB).user.getUserByAddress({ address: ALICE });

    expect(user?.discordId).toBe("");
    expect(user?.nostrKey).toBeNull();
    expect(user?.stakeAddress).toBe("stake_test1ualice");
  });

  it("returns the full row to the address's own wallet session", async () => {
    const user = await walletSession(ALICE).user.getUserByAddress({ address: ALICE });

    expect(user).toEqual(aliceRow);
  });

  it("counts any wallet verified in the session as the caller's own, not only the primary", async () => {
    const user = await walletSession(BOB, [BOB, ALICE]).user.getUserByAddress({
      address: ALICE,
    });

    expect(user?.discordId).toBe(aliceRow.discordId);
  });

  it("returns the full row to a NextAuth session for that address", async () => {
    const user = await nextAuthSession(ALICE).user.getUserByAddress({ address: ALICE });

    expect(user?.discordId).toBe(aliceRow.discordId);
    expect(user?.nostrKey).toBe(aliceRow.nostrKey);
  });

  it("still answers null for an address with no user row", async () => {
    await expect(
      anonymous().user.getUserByAddress({ address: "addr_test1qnobody" }),
    ).resolves.toBeNull();
  });
});

describe("user.getUserDiscordId", () => {
  it("still requires a session", async () => {
    await expect(
      anonymous().user.getUserDiscordId({ address: ALICE }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("returns the caller's own linked Discord account", async () => {
    await expect(
      walletSession(ALICE).user.getUserDiscordId({ address: ALICE }),
    ).resolves.toBe(aliceRow.discordId);
  });

  it("accepts any wallet verified in the session, not only the primary", async () => {
    await expect(
      walletSession(BOB, [BOB, ALICE]).user.getUserDiscordId({ address: ALICE }),
    ).resolves.toBe(aliceRow.discordId);
  });

  it("accepts a NextAuth session for that address", async () => {
    await expect(
      nextAuthSession(ALICE).user.getUserDiscordId({ address: ALICE }),
    ).resolves.toBe(aliceRow.discordId);
  });

  it("answers null for someone else's address, without reading their row", async () => {
    await expect(
      walletSession(BOB).user.getUserDiscordId({ address: ALICE }),
    ).resolves.toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});
