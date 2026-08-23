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
 * The document sign-off feature, end to end, against a real database and with
 * real cryptography.
 *
 * Everything else that covers this feature is a unit test over one piece of it.
 * Nothing exercised the actual chain — create, draft, publish, freeze the signer
 * set, sign, reach the threshold, export a proof, verify it — and that chain is
 * where the interesting failures live. The bug that made `sign()` reject every
 * valid signature survived precisely because the test around it mocked the
 * verification it was meant to prove.
 *
 * So this signs with a real key through the real helper. The wallet is seeded
 * with an address whose mnemonic the test holds, which is what makes a genuine
 * CIP-8 signature possible rather than a fixture pretending to be one.
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
let sign: typeof import("@/utils/signing").sign;
let sha256Hex: typeof import("@/lib/documents/payload").sha256Hex;

// Deterministic throwaway key. Never used for anything but this test.
const MNEMONIC = Array<string>(24).fill("solution");

let wallet: import("@meshsdk/core").MeshWallet;
let ADDRESS: string;
let walletIds: string[] = [];

const BODY = "# Supply agreement\n\nThe ceiling is 50000 EUR.\n";

describeWithDb("document sign-off, end to end", () => {
  beforeAll(async () => {
    ({ createCaller } = await import("@/server/api/root"));
    ({ db } = await import("@/server/db"));
    ({ sign } = await import("@/utils/signing"));
    ({ sha256Hex } = await import("@/lib/documents/payload"));

    const { MeshWallet } = await import("@meshsdk/core");
    wallet = new MeshWallet({
      networkId: 0,
      key: { type: "mnemonic", words: MNEMONIC },
    });
    await wallet.init();
    ADDRESS =
      (await wallet.getUsedAddresses())[0] ??
      (await wallet.getUnusedAddresses())[0]!;
  }, 60_000);

  afterEach(async () => {
    for (const walletId of walletIds) {
      // Document has no foreign key to Wallet, so cleanupFixtures cannot reach
      // it — everything below Document cascades from here.
      await db.document.deleteMany({ where: { walletId } });
      await cleanupFixtures(db, { walletId });
    }
    walletIds = [];
  });

  async function seed() {
    const { walletId } = await seedWallet(db, ADDRESS);
    walletIds.push(walletId);
    // Spread the helper and put the real client back on top rather than casting.
    // makeWalletCtx widens `db` to a union so it can also serve mock-db tests,
    // and `as any` — the pattern the neighbouring suites use — would discard the
    // caller's whole type, which is most of what this test is checking.
    return { walletId, caller: createCaller({ ...makeWalletCtx(ADDRESS), db }) };
  }

  it("carries a draft through to a proof a third party can verify", async () => {
    const { walletId, caller } = await seed();

    // --- create -------------------------------------------------------------
    const document = await caller.document.createDocument({
      walletId,
      title: "Supply agreement",
      documentType: "Legal",
    });
    expect(document.status).toBe("Draft");

    // --- draft, then publish ------------------------------------------------
    // Server storage is opt-in; publishing without it must be refused, because
    // the server would have no bytes to hash.
    await expect(
      caller.document.publishDraft({ documentId: document.id }),
    ).rejects.toThrow(/not stored on the server/i);

    const saved = await caller.document.saveDraft({
      documentId: document.id,
      body: BODY,
      storeBody: true,
    });
    expect(saved.revision).toBe(1);

    const version = await caller.document.publishDraft({
      documentId: document.id,
    });

    // The hash is the SERVER's, over the bytes it stored — not something the
    // client asserted. That is what makes "what you sign is what was
    // published" true rather than claimed.
    expect(version.contentHash).toBe(sha256Hex(Buffer.from(BODY, "utf8")));
    expect(version.storageMode).toBe("inline");
    expect(version.versionNumber).toBe(1);

    // --- freeze the signer set ---------------------------------------------
    await caller.document.startReview({ versionId: version.id });
    const snapshot = await db.documentSignerSnapshot.findUnique({
      where: { versionId: version.id },
    });
    expect(snapshot?.signersAddresses).toEqual([ADDRESS]);
    expect(snapshot?.requiredSigners).toBe(1);

    // --- sign, exactly the way the review page does -------------------------
    const fresh = await caller.document.getVersionForReview({
      versionId: version.id,
      action: "approve",
      signerAddress: ADDRESS,
    });
    expect(fresh.payloadToSign).toBeTruthy();

    // The real helper and a real key. Before the signature fix this line threw
    // "Signature failed verification" for every honest signature.
    const signature = await sign(fresh.payloadToSign!, wallet, 0, ADDRESS);

    await caller.document.submitSignerAction({
      versionId: version.id,
      action: "approve",
      signerAddress: ADDRESS,
      signedAt: fresh.payload!.signedAt,
      payload: fresh.payloadToSign!,
      signature: signature.signature,
      signatureKey: signature.key,
    });

    // --- the threshold resolves --------------------------------------------
    const decided = await db.documentVersion.findUnique({
      where: { id: version.id },
    });
    expect(decided?.status).toBe("Approved");
    expect(decided?.decidedAt).toBeTruthy();

    // --- and the proof verifies, through the public procedure ---------------
    const proof = await caller.document.exportProof({ versionId: version.id });
    const verified = await caller.document.verifyProof({
      proof,
      expectedContentHash: version.contentHash,
    });
    expect(verified.valid).toBe(true);
  }, 120_000);

  it("refuses a signature over bytes the server did not build", async () => {
    const { walletId, caller } = await seed();
    const document = await caller.document.createDocument({
      walletId,
      title: "Tampered",
    });
    await caller.document.saveDraft({
      documentId: document.id,
      body: BODY,
      storeBody: true,
    });
    const version = await caller.document.publishDraft({
      documentId: document.id,
    });
    await caller.document.startReview({ versionId: version.id });

    const fresh = await caller.document.getVersionForReview({
      versionId: version.id,
      action: "approve",
      signerAddress: ADDRESS,
    });

    // Sign a statement of our own choosing, then present it as the review. The
    // server rebuilds the payload from its own records and byte-compares, so
    // the substitution must be caught before the signature is even checked.
    //
    // Tamper with the content hash rather than the prose: the payload binds the
    // DIGEST, not the body, so altering body text would leave the signed bytes
    // identical and prove nothing.
    const forged = fresh.payloadToSign!.replace(
      version.contentHash,
      "b".repeat(64),
    );
    expect(forged).not.toBe(fresh.payloadToSign);
    const signature = await sign(forged, wallet, 0, ADDRESS);

    await expect(
      caller.document.submitSignerAction({
        versionId: version.id,
        action: "approve",
        signerAddress: ADDRESS,
        signedAt: fresh.payload!.signedAt,
        payload: forged,
        signature: signature.signature,
        signatureKey: signature.key,
      }),
    ).rejects.toThrow();

    const still = await db.documentVersion.findUnique({
      where: { id: version.id },
    });
    expect(still?.status).toBe("InReview");
  }, 120_000);

  it("resets approvals when a new version supersedes a signed one", async () => {
    const { walletId, caller } = await seed();
    const document = await caller.document.createDocument({
      walletId,
      title: "Reissued",
    });
    await caller.document.saveDraft({
      documentId: document.id,
      body: BODY,
      storeBody: true,
    });
    const v1 = await caller.document.publishDraft({ documentId: document.id });
    await caller.document.startReview({ versionId: v1.id });

    const fresh = await caller.document.getVersionForReview({
      versionId: v1.id,
      action: "approve",
      signerAddress: ADDRESS,
    });
    const signature = await sign(fresh.payloadToSign!, wallet, 0, ADDRESS);
    await caller.document.submitSignerAction({
      versionId: v1.id,
      action: "approve",
      signerAddress: ADDRESS,
      signedAt: fresh.payload!.signedAt,
      payload: fresh.payloadToSign!,
      signature: signature.signature,
      signatureKey: signature.key,
    });
    expect(
      (await db.documentVersion.findUnique({ where: { id: v1.id } }))?.status,
    ).toBe("Approved");

    // A new version is a new agreement. Approval binds the content hash, not
    // the title, so the old signature must not carry over.
    await caller.document.saveDraft({
      documentId: document.id,
      body: `${BODY}\nAmended.\n`,
      expectedRevision: 1,
    });
    const v2 = await caller.document.publishDraft({ documentId: document.id });

    expect(v2.versionNumber).toBe(2);
    expect(v2.contentHash).not.toBe(v1.contentHash);
    expect(
      (await db.documentVersion.findUnique({ where: { id: v1.id } }))?.status,
    ).toBe("Superseded");
    expect(await db.documentReview.count({ where: { versionId: v2.id } })).toBe(
      0,
    );
  }, 120_000);
});
