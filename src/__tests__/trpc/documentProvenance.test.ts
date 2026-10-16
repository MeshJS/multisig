import { generateKeyPairSync } from "crypto";
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
 * Document Sign-Off v1 — Revision Provenance, end to end against a real
 * database, with real CIP-8 signatures and a real attestation key.
 *
 * The chain under test: approve v1, supersede it with v2, diff the two, roll
 * back to v1 (as v3), and export an audit package that an outside party can
 * verify — including that the rollback did NOT resurrect v1's approvals.
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

// Attestation is optional per deployment; turn it on here so the chain is part
// of what the audit export is checked against. Set before any app module is
// imported, because @/env reads the environment once.
const ATTESTATION_KEY = generateKeyPairSync("ed25519")
  .privateKey.export({ type: "pkcs8", format: "der" })
  .toString("base64");
process.env.DOCUMENT_ATTESTATION_KEY = ATTESTATION_KEY;

const HAVE_DB = !!process.env.DATABASE_URL;
const describeWithDb = HAVE_DB ? describe : describe.skip;

let createCaller: typeof import("@/server/api/root").createCaller;
let db: typeof import("@/server/db").db;
let sign: typeof import("@/utils/signing").sign;
let verifyAuditPackage: typeof import("@/lib/documents/audit").verifyAuditPackage;
let getAttestationPublicKeys: typeof import("@/lib/documents/attestation-key").getAttestationPublicKeys;
let checkSignature: typeof import("@meshsdk/core").checkSignature;

// Deterministic throwaway key. Never used for anything but this test.
const MNEMONIC = Array<string>(24).fill("solution");
const OUTSIDER =
  "addr_test1vpu5vlrf4xkxv2qpwngf6cjhtw542ayty80v8dyr49rf5eg0yu80w";

let wallet: import("@meshsdk/core").MeshWallet;
let ADDRESS: string;
let walletIds: string[] = [];

const BODY =
  "# Supply agreement\n\nThe ceiling is 50000 EUR.\n\nTerm: 12 months.\n";
const AMENDED =
  "# Supply agreement\n\nThe ceiling is 90000 EUR.\n\nTerm: 12 months.\n";

describeWithDb("document provenance — diff, rollback, audit", () => {
  beforeAll(async () => {
    ({ createCaller } = await import("@/server/api/root"));
    ({ db } = await import("@/server/db"));
    ({ sign } = await import("@/utils/signing"));
    ({ verifyAuditPackage } = await import("@/lib/documents/audit"));
    ({ getAttestationPublicKeys } =
      await import("@/lib/documents/attestation-key"));

    const mesh = await import("@meshsdk/core");
    checkSignature = mesh.checkSignature;
    wallet = new mesh.MeshWallet({
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
      await db.document.deleteMany({ where: { walletId } });
      await cleanupFixtures(db, { walletId });
    }
    walletIds = [];
  });

  async function seed() {
    const { walletId } = await seedWallet(db, ADDRESS);
    walletIds.push(walletId);
    return {
      walletId,
      caller: createCaller({ ...makeWalletCtx(ADDRESS), db }),
    };
  }

  type Caller = Awaited<ReturnType<typeof seed>>["caller"];

  async function approve(caller: Caller, versionId: string) {
    await caller.document.startReview({ versionId });
    const fresh = await caller.document.getVersionForReview({
      versionId,
      action: "approve",
      signerAddress: ADDRESS,
    });
    const signature = await sign(fresh.payloadToSign!, wallet, 0, ADDRESS);
    await caller.document.submitSignerAction({
      versionId,
      action: "approve",
      signerAddress: ADDRESS,
      signedAt: fresh.payload!.signedAt,
      payload: fresh.payloadToSign!,
      signature: signature.signature,
      signatureKey: signature.key,
    });
  }

  async function publish(caller: Caller, documentId: string, body: string) {
    const draft = await db.documentDraft.findUnique({ where: { documentId } });
    await caller.document.saveDraft({
      documentId,
      body,
      storeBody: true,
      ...(draft ? { expectedRevision: draft.revision } : {}),
    });
    return caller.document.publishDraft({ documentId });
  }

  it("diffs, rolls back without resurrecting approvals, and exports a verifiable audit", async () => {
    const { walletId, caller } = await seed();
    const document = await caller.document.createDocument({
      walletId,
      title: "Supply agreement",
    });

    // --- v1 approved, v2 supersedes it --------------------------------------
    const v1 = await publish(caller, document.id, BODY);
    await approve(caller, v1.id);
    expect(
      (await db.documentVersion.findUnique({ where: { id: v1.id } }))?.status,
    ).toBe("Approved");
    const v2 = await publish(caller, document.id, AMENDED);

    // --- diff ----------------------------------------------------------------
    const diff = await caller.document.diffVersions({
      documentId: document.id,
      fromVersionId: v1.id,
      toVersionId: v2.id,
    });
    expect(diff.contentChanged).toBe(true);
    expect(diff.content).toMatchObject({ kind: "text", added: 1, removed: 1 });
    if (diff.content.kind !== "text") throw new Error("expected a text diff");
    const changed = diff.content.hunks
      .flatMap((h) => h.lines)
      .filter((l) => l.op !== "equal")
      .map((l) => `${l.op}:${l.text}`);
    expect(changed).toEqual([
      "add:The ceiling is 90000 EUR.",
      "remove:The ceiling is 50000 EUR.",
    ]);

    // --- rollback ------------------------------------------------------------
    // Restoring the current head is a no-op and is refused, not duplicated.
    await expect(
      caller.document.restoreVersion({
        documentId: document.id,
        versionId: v2.id,
      }),
    ).rejects.toThrow(/already the current version/);

    const v3 = await caller.document.restoreVersion({
      documentId: document.id,
      versionId: v1.id,
    });
    expect(v3.versionNumber).toBe(3);
    expect(v3.contentHash).toBe(v1.contentHash);
    expect(v3.contentInline).toBe(v1.contentInline);
    expect(v3.status).toBe("Draft");
    // The point of the whole design: v1's approval stays on v1.
    expect(await db.documentReview.count({ where: { versionId: v3.id } })).toBe(
      0,
    );
    expect(await db.documentReview.count({ where: { versionId: v1.id } })).toBe(
      1,
    );
    expect(
      (await db.documentVersion.findUnique({ where: { id: v2.id } }))?.status,
    ).toBe("Superseded");

    const restoredEvent = await db.documentEvent.findFirst({
      where: { versionId: v3.id, type: "version.restored" },
    });
    expect(restoredEvent?.metadata).toMatchObject({
      restoredFromVersionNumber: 1,
      restoredFromVersionId: v1.id,
      replacedVersionNumber: 2,
      approvalsReset: true,
    });

    const sameContent = await caller.document.diffVersions({
      documentId: document.id,
      fromVersionId: v1.id,
      toVersionId: v3.id,
    });
    expect(sameContent.contentChanged).toBe(false);
    expect(sameContent.content.kind).toBe("identical");

    // --- audit export --------------------------------------------------------
    const pkg = await caller.document.exportAudit({ documentId: document.id });
    expect(pkg.versions.map((v) => v.lineage)).toEqual([
      { origin: "draft", supersedes: null, restoredFrom: null },
      { origin: "draft", supersedes: 1, restoredFrom: null },
      { origin: "restore", supersedes: 2, restoredFrom: 1 },
    ]);
    expect(pkg.attestation?.chain).toHaveLength(3);
    expect(
      await db.documentEvent.count({
        where: { documentId: document.id, type: "audit.exported" },
      }),
    ).toBe(1);

    // Checked offline, with the real CIP-8 verifier and the deployment's keys.
    const result = await verifyAuditPackage(pkg, {
      checkSignature,
      publicKeys: getAttestationPublicKeys(),
    });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.chain?.ok).toBe(true);
    expect(
      result.versions.map((v) => [
        v.versionNumber,
        v.approvals,
        v.thresholdReached,
      ]),
    ).toEqual([
      [1, 1, true],
      [2, 0, false],
      [3, 0, false],
    ]);

    // The public procedure reaches the same verdict.
    const remote = await caller.document.verifyAudit({ audit: pkg });
    expect(remote.valid).toBe(true);

    // And catches a tampered export: drop the version that was rolled back from.
    const tampered = JSON.parse(JSON.stringify(pkg)) as typeof pkg;
    tampered.versions.splice(1, 1);
    expect((await caller.document.verifyAudit({ audit: tampered })).valid).toBe(
      false,
    );
  }, 180_000);

  it("keeps rollback and the audit export to wallet members", async () => {
    const { walletId, caller } = await seed();
    const document = await caller.document.createDocument({
      walletId,
      title: "Members only",
    });
    const v1 = await publish(caller, document.id, BODY);
    await publish(caller, document.id, AMENDED);

    const outsider = createCaller({ ...makeWalletCtx(OUTSIDER), db });
    await expect(
      outsider.document.restoreVersion({
        documentId: document.id,
        versionId: v1.id,
      }),
    ).rejects.toThrow(/not authorized/i);
    await expect(
      outsider.document.exportAudit({ documentId: document.id }),
    ).rejects.toThrow(/not authorized/i);
    await expect(
      outsider.document.diffVersions({
        documentId: document.id,
        fromVersionId: v1.id,
        toVersionId: v1.id,
      }),
    ).rejects.toThrow(/not authorized/i);
  }, 120_000);

  it("refuses to restore a version from a different document", async () => {
    const { walletId, caller } = await seed();
    const a = await caller.document.createDocument({ walletId, title: "A" });
    const b = await caller.document.createDocument({ walletId, title: "B" });
    const aV1 = await publish(caller, a.id, BODY);
    await publish(caller, b.id, AMENDED);

    await expect(
      caller.document.restoreVersion({ documentId: b.id, versionId: aV1.id }),
    ).rejects.toThrow(/not found on this document/i);
    await expect(
      caller.document.diffVersions({
        documentId: b.id,
        fromVersionId: aV1.id,
        toVersionId: aV1.id,
      }),
    ).rejects.toThrow(/not found on this document/i);
  }, 120_000);
});
