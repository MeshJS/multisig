import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import { cleanupFixtures, seedWallet } from "./fixtures";
import { makeWalletCtx } from "./helpers";

/**
 * The access layer for contract parties.
 *
 * This is the gate the whole contract feature was blocked behind: every
 * document procedure authorizes through `assertWalletAccess`, and a named
 * counterparty is in neither `signersAddresses` nor `ownerAddress`, so they were
 * rejected with FORBIDDEN before any party logic could run.
 *
 * These tests are written from the outside: an OUTSIDER — a real signed-in user
 * who is not a member of the wallet — must be unable to touch the document
 * until they redeem an invite, and must then be able to read exactly that one
 * document and nothing else.
 */

jest.mock("superjson", () => ({
  __esModule: true,
  default: {
    serialize: (value: unknown) => value,
    deserialize: (value: unknown) => value,
  },
}));

jest.mock("@/server/auth", () => ({
  __esModule: true,
  getServerAuthSession: jest.fn(),
}));

const HAVE_DB = !!process.env.DATABASE_URL;
const describeWithDb = HAVE_DB ? describe : describe.skip;

let createCaller: typeof import("@/server/api/root").createCaller;
let db: typeof import("@/server/db").db;

const MEMBER = "addr_test1member_contract";
const OUTSIDER = "addr_test1outsider_contract";
const STRANGER = "addr_test1stranger_contract";

let walletIds: string[] = [];

describeWithDb("contract parties and invites", () => {
  beforeAll(async () => {
    ({ createCaller } = await import("@/server/api/root"));
    ({ db } = await import("@/server/db"));
  });

  afterEach(async () => {
    for (const walletId of walletIds) {
      await db.document.deleteMany({ where: { walletId } });
      await cleanupFixtures(db, { walletId });
    }
    walletIds = [];
  });

  const callerFor = (address: string) =>
    createCaller({ ...makeWalletCtx(address), db });

  async function seedContract() {
    const { walletId } = await seedWallet(db, MEMBER);
    walletIds.push(walletId);
    const member = callerFor(MEMBER);
    const document = await member.document.createDocument({
      walletId,
      title: "Supply agreement",
      documentType: "Legal",
    });
    return { walletId, document, member };
  }

  it("locks an outsider out until they redeem an invite, then lets them in", async () => {
    const { document, member } = await seedContract();

    const party = await member.document.upsertContractParty({
      documentId: document.id,
      role: "Buyer",
      displayName: "Ada",
      email: "ada@example.com",
    });

    // Before redeeming: the outsider is a real signed-in user and still has no
    // business with this document.
    await expect(
      callerFor(OUTSIDER).document.getById({ documentId: document.id }),
    ).rejects.toThrow(/not authorized/i);

    // Naming an address on a party is not identity — only redemption is.
    await db.contractParty.update({
      where: { id: party.id },
      data: { address: OUTSIDER },
    });
    await expect(
      callerFor(OUTSIDER).document.getById({ documentId: document.id }),
    ).rejects.toThrow(/not authorized/i);
    await db.contractParty.update({
      where: { id: party.id },
      data: { address: null },
    });

    const { token } = await member.document.issuePartyInvite({
      partyId: party.id,
    });
    const redeemed = await callerFor(OUTSIDER).document.redeemPartyInvite({
      token,
    });
    expect(redeemed).toEqual({ documentId: document.id, role: "Buyer" });

    // After redeeming: in, and bound to their own address.
    const seen = await callerFor(OUTSIDER).document.getById({
      documentId: document.id,
    });
    expect(seen?.id).toBe(document.id);
    expect(
      (await db.contractParty.findUnique({ where: { id: party.id } }))?.address,
    ).toBe(OUTSIDER);
  }, 60_000);

  it("grants nothing beyond the one document", async () => {
    const { document, member, walletId } = await seedContract();
    const other = await member.document.createDocument({
      walletId,
      title: "Unrelated",
    });

    const party = await member.document.upsertContractParty({
      documentId: document.id,
      role: "Buyer",
      displayName: "Ada",
    });
    const { token } = await member.document.issuePartyInvite({
      partyId: party.id,
    });
    await callerFor(OUTSIDER).document.redeemPartyInvite({ token });

    // Being a party to one contract is not membership of the wallet.
    await expect(
      callerFor(OUTSIDER).document.getById({ documentId: other.id }),
    ).rejects.toThrow(/not authorized/i);
    await expect(
      callerFor(OUTSIDER).document.listByWallet({ walletId }),
    ).rejects.toThrow(/not authorized/i);
    await expect(
      callerFor(OUTSIDER).document.upsertContractParty({
        documentId: document.id,
        role: "Seller",
        displayName: "Someone else",
      }),
    ).rejects.toThrow(/not authorized/i);
  }, 60_000);

  it("burns an invite on use and refuses it to anyone after", async () => {
    const { document, member } = await seedContract();
    const party = await member.document.upsertContractParty({
      documentId: document.id,
      role: "Buyer",
      displayName: "Ada",
    });
    const { token } = await member.document.issuePartyInvite({
      partyId: party.id,
    });

    await callerFor(OUTSIDER).document.redeemPartyInvite({ token });

    // The same link, forwarded on, must not bind a second person.
    await expect(
      callerFor(STRANGER).document.redeemPartyInvite({ token }),
    ).rejects.toThrow(/not valid/i);
    expect(
      (await db.contractParty.findUnique({ where: { id: party.id } }))?.address,
    ).toBe(OUTSIDER);
  }, 60_000);

  it("refuses an expired invite and an invented one alike", async () => {
    const { document, member } = await seedContract();
    const party = await member.document.upsertContractParty({
      documentId: document.id,
      role: "Buyer",
      displayName: "Ada",
    });
    const { token } = await member.document.issuePartyInvite({
      partyId: party.id,
    });
    await db.contractParty.update({
      where: { id: party.id },
      data: { inviteExpiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      callerFor(OUTSIDER).document.redeemPartyInvite({ token }),
    ).rejects.toThrow(/not valid/i);

    // The same message for a token that never existed — distinguishing the two
    // would turn this into an oracle for guessing.
    await expect(
      callerFor(OUTSIDER).document.redeemPartyInvite({
        token: "x".repeat(43),
      }),
    ).rejects.toThrow(/not valid/i);
  }, 60_000);

  it("supports one human holding two roles", async () => {
    const { document, member } = await seedContract();
    const tenant = await member.document.upsertContractParty({
      documentId: document.id,
      role: "Tenant",
      displayName: "Ada",
      signingOrder: 0,
    });
    const guarantor = await member.document.upsertContractParty({
      documentId: document.id,
      role: "Guarantor",
      displayName: "Ada",
      signingOrder: 1,
    });

    for (const p of [tenant, guarantor]) {
      const { token } = await member.document.issuePartyInvite({
        partyId: p.id,
      });
      await callerFor(OUTSIDER).document.redeemPartyInvite({ token });
    }

    // One address, two capacities — the thing the old unique index forbade.
    const parties = await db.contractParty.findMany({
      where: { documentId: document.id, address: OUTSIDER },
    });
    expect(parties).toHaveLength(2);
    expect(parties.map((p) => p.role).sort()).toEqual(["Guarantor", "Tenant"]);
  }, 60_000);

  it("freezes the roster once a round has started", async () => {
    const { document, member } = await seedContract();
    await member.document.saveDraft({
      documentId: document.id,
      body: "# Terms\n",
      storeBody: true,
    });
    const version = await member.document.publishDraft({
      documentId: document.id,
    });
    await member.document.startReview({ versionId: version.id });

    // The snapshot is frozen; the roster it was taken from must be too.
    await expect(
      member.document.upsertContractParty({
        documentId: document.id,
        role: "Late arrival",
        displayName: "Bob",
      }),
    ).rejects.toThrow(/already started/i);
  }, 60_000);

  it("never returns the invite hash", async () => {
    const { document, member } = await seedContract();
    const party = await member.document.upsertContractParty({
      documentId: document.id,
      role: "Buyer",
      displayName: "Ada",
    });
    await member.document.issuePartyInvite({ partyId: party.id });

    const listed = await member.document.listContractParties({
      documentId: document.id,
    });
    expect(listed[0]).toMatchObject({
      role: "Buyer",
      invited: true,
      redeemed: false,
    });
    expect(JSON.stringify(listed)).not.toContain("inviteTokenHash");
  }, 60_000);
});
