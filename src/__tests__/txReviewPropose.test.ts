import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PrismaClient } from "@prisma/client";

import type { McpCaller } from "@/lib/mcp/auth";
import type { ToolContext } from "@/lib/mcp/tools";
import type { TxSpec } from "@/lib/tx-review/spec";
import type { TxReviewSummary } from "@/lib/tx-review/summary";

/**
 * `transaction_propose` orchestration: the token is the only input, the
 * created row starts unsigned, rationales are pinned exactly once and only
 * after validation, a replayed token returns the first transaction, and no
 * path leads to a broadcast. The build itself is exercised by the tx-draft
 * tests; here it is a stub returning a fixed body.
 */

const loadReviewWalletContextMock = jest.fn<(...args: any[]) => Promise<any>>();
const loadSpendableUtxosMock = jest.fn<(...args: any[]) => Promise<any>>();
const loadSpecAssetMetadataMock = jest.fn<(...args: any[]) => Promise<any>>();
const validateOrThrowMock = jest.fn<(...args: any[]) => any>();
const loadStakeAccountActiveMock = jest.fn<(...args: any[]) => Promise<boolean | undefined>>();
const loadDrepRegisteredMock = jest.fn<(...args: any[]) => Promise<boolean | undefined>>();
const buildUnsignedMock = jest.fn<(...args: any[]) => Promise<any>>();
const summarizeForWalletMock = jest.fn<(...args: any[]) => Promise<any>>();
const renderCardMock = jest.fn<(...args: any[]) => Promise<any>>();
const auditMock = jest.fn<(...args: any[]) => Promise<void>>();

jest.mock("@/lib/tx-review/context", () => {
  const actual = jest.requireActual("@/lib/tx-review/context") as object;
  return { __esModule: true, ...actual, loadReviewWalletContext: loadReviewWalletContextMock };
});

jest.mock("@/lib/tx-review/pipeline", () => {
  const actual = jest.requireActual("@/lib/tx-review/pipeline") as object;
  return {
    __esModule: true,
    ...actual,
    loadSpendableUtxos: loadSpendableUtxosMock,
    loadSpecAssetMetadata: loadSpecAssetMetadataMock,
    validateOrThrow: validateOrThrowMock,
    loadStakeAccountActive: loadStakeAccountActiveMock,
    loadDrepRegistered: loadDrepRegisteredMock,
    buildUnsigned: buildUnsignedMock,
    summarizeForWallet: summarizeForWalletMock,
    renderCard: renderCardMock,
  };
});

jest.mock("@/lib/observability/audit", () => ({ __esModule: true, audit: auditMock }));

const SUBJECT = "addr_test1qpsubject";
const CLIENT = "https://claude.ai/x";
const PROPOSAL_HASH = "c".repeat(64);

const caller: McpCaller = {
  subject: SUBJECT,
  addresses: [SUBJECT],
  scopes: ["transactions:write"],
  clientName: CLIENT,
  botId: null,
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
};
const ctx: ToolContext = { caller, clientIp: "127.0.0.1" };

const walletRow = {
  id: "wallet-1",
  name: "Treasury",
  signersAddresses: [SUBJECT, "addr_test1qpother"],
  signersDescriptions: ["Me", "Other"],
  numRequiredSigners: 2,
  type: "atLeast",
};

const walletCtx = {
  walletRow,
  network: 0 as const,
  walletAddress: "addr_test1qpwallet",
  scriptCbor: "8200",
  drep: { dRepId: "drep1x", drepScriptCbor: "8201" },
  stake: undefined,
  threshold: { required: 2, total: 2, type: "atLeast" },
};

const builtBody = {
  inputs: [{ txIn: { txHash: "1".repeat(64), txIndex: 0 } }],
  outputs: [{ address: "addr_test1qprecipient", amount: [{ unit: "lovelace", quantity: "5000000" }] }],
  changeAddress: "addr_test1qpwallet",
  fee: "170000",
  certificates: [],
  votes: [],
};

const fakeSummary: TxReviewSummary = {
  kind: "pending",
  wallet: { id: "wallet-1", name: "Treasury", address: "addr_test1qpwallet", network: "preprod" },
  threshold: { required: 2, total: 2, type: "atLeast" },
  signatures: { signed: [], rejected: [], remaining: 2 },
  description: "Pay",
  metadataMessage: "",
  recipients: [],
  change: [],
  inputs: { count: 1, total: [], unresolved: 0 },
  fee: null,
  deposit: null,
  actions: [],
  txHash: "beef",
  transactionId: "tx-new",
  warnings: [],
  generatedAt: "2026-09-07T12:00:00.000Z",
};

function spec(overrides: Partial<TxSpec> = {}): TxSpec {
  return {
    v: 1,
    walletId: "wallet-1",
    outputs: [{ address: "addr_test1qprecipient", assets: [{ unit: "lovelace", quantity: "5000000" }] }],
    certificates: [],
    votes: [],
    description: "Pay",
    metadataMessage: "",
    ...overrides,
  };
}

let mintDraftToken: typeof import("@/lib/tx-review/draft-token").mintDraftToken;
let runTransactionPropose: typeof import("@/lib/tx-review/propose").runTransactionPropose;

function makeDb(pending: { id: string; txJson: string }[] = []) {
  return {
    transaction: {
      findMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue(
        pending.map((row) => ({
          ...row,
          txHash: null,
          description: "Pay",
          signedAddresses: [],
          rejectedAddresses: [],
        })),
      ),
    },
  } as unknown as PrismaClient;
}

function deps(extra: Record<string, unknown> = {}) {
  const createPending = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({
    id: "tx-new",
    signedAddresses: [],
    rejectedAddresses: [],
  });
  const pin = jest.fn<(filename: string, json: string) => Promise<{ url: string }>>().mockResolvedValue({
    url: "ipfs://cid",
  });
  return {
    db: makeDb(),
    fetchFreeUtxos: jest.fn<() => Promise<any>>().mockResolvedValue({ status: 200, body: [] }),
    createPending,
    pin,
    hashAnchor: () => "ff".repeat(32),
    ...extra,
  };
}

// Minted as an image-mode preview unless told otherwise: propose follows the
// mode recorded in the token, and most of these tests look at the PNG path.
function token(overrides: Partial<TxSpec> = {}, previewTxHash = "beef", card: "html" | "image" = "image") {
  return mintDraftToken({
    subject: SUBJECT,
    walletId: "wallet-1",
    clientId: CLIENT,
    spec: spec(overrides),
    previewTxHash,
    card,
  }).token;
}

beforeEach(async () => {
  jest.clearAllMocks();
  ({ mintDraftToken } = await import("@/lib/tx-review/draft-token"));
  ({ runTransactionPropose } = await import("@/lib/tx-review/propose"));
  loadReviewWalletContextMock.mockResolvedValue(walletCtx);
  loadSpendableUtxosMock.mockResolvedValue([]);
  loadSpecAssetMetadataMock.mockResolvedValue({ metadata: {}, decimalsFor: () => undefined });
  validateOrThrowMock.mockReturnValue([]);
  loadStakeAccountActiveMock.mockResolvedValue(undefined);
  loadDrepRegisteredMock.mockResolvedValue(undefined);
  buildUnsignedMock.mockResolvedValue({
    unsignedTx: "84a4",
    body: builtBody,
    txHash: "beef",
    fee: "170000",
    sizeBytes: 2,
    inputCount: 1,
    outputCount: 2,
  });
  summarizeForWalletMock.mockResolvedValue(fakeSummary);
  renderCardMock.mockResolvedValue({ data: "AAAA", mimeType: "image/png" });
  auditMock.mockResolvedValue(undefined);
});

describe("transaction_propose", () => {
  it("creates the pending transaction unsigned, with MCP provenance, and returns the card", async () => {
    const d = deps();
    const result = await runTransactionPropose({ draftToken: token() }, ctx, d);

    expect(result.status).toBe(201);
    expect(d.createPending).toHaveBeenCalledTimes(1);
    const args = d.createPending.mock.calls[0]![1];
    expect(args).toMatchObject({
      walletId: "wallet-1",
      proposerAddress: SUBJECT,
      txCbor: "84a4",
      description: "Pay",
      network: 0,
      initialSignedAddresses: [],
      notificationCreatorAddress: null,
    });
    // Provenance rides at the top level of txJson, never under `multisig`
    // (which signTransaction.ts overwrites on every signature).
    expect(args.txJson.mcp).toMatchObject({
      client: CLIENT,
      proposer: SUBJECT,
      previewTxHash: "beef",
    });
    expect(typeof args.txJson.mcp.draftId).toBe("string");
    expect(args.txJson.multisig).toBeUndefined();

    const body = result.body as Record<string, unknown>;
    expect(body).toMatchObject({
      transactionId: "tx-new",
      alreadyExisted: false,
      txHash: "beef",
      txHashChanged: false,
      signaturesRequired: 2,
      signaturesCollected: 0,
      persisted: true,
      signed: false,
      broadcast: false,
    });
    expect(String(body.link)).toMatch(/\/wallets\/wallet-1\/transactions$/);
    expect(result.images).toEqual([{ data: "AAAA", mimeType: "image/png" }]);
    expect(result.audit).toMatchObject({ walletId: "wallet-1", transactionId: "tx-new", txHash: "beef" });
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "transaction.create", resourceId: "tx-new" }),
    );
    // The summary is built for a pending transaction with nobody signed.
    expect(summarizeForWalletMock).toHaveBeenCalledWith(
      expect.anything(),
      builtBody,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ kind: "pending", signedAddresses: [], transactionId: "tx-new", paymentCount: 1 }),
    );
  });

  it("rejects anything but a valid draft token", async () => {
    const d = deps();
    const bad = await runTransactionPropose({ draftToken: "not-a-token" }, ctx, d);
    expect(bad.status).toBe(401);
    expect((bad.body as { code: string }).code).toBe("TOKEN_INVALID");

    const other = mintDraftToken({
      subject: "addr_test1qpother",
      walletId: "wallet-1",
      clientId: CLIENT,
      spec: spec(),
      previewTxHash: "beef",
    }).token;
    const mismatch = await runTransactionPropose({ draftToken: other }, ctx, d);
    expect(mismatch.status).toBe(403);
    expect(d.createPending).not.toHaveBeenCalled();
    expect(d.pin).not.toHaveBeenCalled();
  });

  it("replays idempotently: the same token never makes a second transaction", async () => {
    const t = token();
    const d = deps();
    const first = await runTransactionPropose({ draftToken: t }, ctx, d);
    const draftId = (d.createPending.mock.calls[0]![1] as { txJson: { mcp: { draftId: string } } }).txJson.mcp.draftId;

    const replayDeps = deps({
      db: makeDb([{ id: "tx-first", txJson: JSON.stringify({ ...builtBody, mcp: { draftId } }) }]),
    });
    const second = await runTransactionPropose({ draftToken: t }, ctx, replayDeps);

    expect((first.body as { transactionId: string }).transactionId).toBe("tx-new");
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ transactionId: "tx-first", alreadyExisted: true });
    expect(replayDeps.createPending).not.toHaveBeenCalled();
    expect(replayDeps.pin).not.toHaveBeenCalled();
    expect(buildUnsignedMock).toHaveBeenCalledTimes(1);
    expect(second.images).toHaveLength(1);
  });

  it("pins each vote rationale once, after validation, and anchors the vote", async () => {
    const d = deps();
    const t = token({
      outputs: [],
      votes: [
        { govActionTxHash: PROPOSAL_HASH, govActionIndex: 0, voteKind: "Yes", rationale: "Because it is good." },
        { govActionTxHash: PROPOSAL_HASH, govActionIndex: 1, voteKind: "No" },
      ],
    });
    buildUnsignedMock.mockResolvedValue({
      unsignedTx: "84a4",
      body: builtBody,
      txHash: "d00d",
      fee: "1",
      sizeBytes: 2,
      inputCount: 1,
      outputCount: 1,
    });

    const result = await runTransactionPropose({ draftToken: t }, ctx, d);

    expect(d.pin).toHaveBeenCalledTimes(1);
    const [filename, json] = d.pin.mock.calls[0]!;
    expect(filename).toMatch(/^rationale-c{16}-0\.jsonld$/);
    expect(JSON.parse(json).body.rationaleStatement).toBe("Because it is good.");
    // Validation ran before pinning, on the anchor-less draft.
    const validateOrder = validateOrThrowMock.mock.invocationCallOrder[0]!;
    const pinOrder = d.pin.mock.invocationCallOrder[0]!;
    expect(validateOrder).toBeLessThan(pinOrder);
    // The built draft carries the anchor on the first vote only.
    const draft = buildUnsignedMock.mock.calls[0]![0];
    expect(draft.votes[0]).toMatchObject({
      anchor: { anchorUrl: "ipfs://cid", anchorDataHash: "ff".repeat(32) },
    });
    expect(draft.votes[0].rationaleEdit).toBeUndefined();
    expect(draft.votes[1].anchor).toBeUndefined();
    expect(result.body).toMatchObject({
      txHashChanged: true,
      txHashChangeReasons: ["rationale-anchors"],
      rationalesPublished: 1,
    });
  });

  it("reports a UTxO-driven hash change as a warning, not an error", async () => {
    buildUnsignedMock.mockResolvedValue({
      unsignedTx: "84a4",
      body: builtBody,
      txHash: "0ther",
      fee: "1",
      sizeBytes: 2,
      inputCount: 1,
      outputCount: 1,
    });
    const result = await runTransactionPropose({ draftToken: token() }, ctx, deps());
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ txHashChanged: true, txHashChangeReasons: ["utxo-set"] });
    expect(summarizeForWalletMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        warnings: [expect.stringContaining("spendable UTxOs changed since the preview")],
      }),
    );
  });

  it("surfaces a failed pin as an error and creates nothing", async () => {
    const d = deps({
      pin: jest.fn<() => Promise<{ url: string }>>().mockRejectedValue(new Error("Pinata down")),
    });
    const result = await runTransactionPropose(
      {
        draftToken: token({
          outputs: [],
          votes: [{ govActionTxHash: PROPOSAL_HASH, govActionIndex: 0, voteKind: "Yes", rationale: "r" }],
        }),
      },
      ctx,
      d,
    );
    expect(result.status).toBe(502);
    expect((result.body as { code: string }).code).toBe("PIN_FAILED");
    expect(d.createPending).not.toHaveBeenCalled();
  });

  it("returns validation failures as a readable 400 without pinning or creating", async () => {
    const { TxReviewError } = jest.requireActual("@/lib/tx-review/context") as typeof import("@/lib/tx-review/context");
    validateOrThrowMock.mockImplementation(() => {
      throw new TxReviewError(400, "INVALID_DRAFT", "Outputs require more ADA than the selected funds hold.", {
        issues: [{ level: "error", code: "insufficient-funds", message: "x" }],
      });
    });
    const d = deps();
    const result = await runTransactionPropose({ draftToken: token() }, ctx, d);
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: "INVALID_DRAFT", issues: [{ code: "insufficient-funds" }] });
    expect(d.createPending).not.toHaveBeenCalled();
    expect(d.pin).not.toHaveBeenCalled();
  });

  it("re-checks the stake account's registration state at propose time", async () => {
    // Registered since the preview: the token's register+delegate would now
    // fail on chain, so the fresh state must reach validation (which refuses
    // it as cert-already-registered — a validate.ts unit test).
    const stakeCtx = { ...walletCtx, stake: { rewardAddress: "stake_test1uqx", stakeScriptCbor: "8202" } };
    loadReviewWalletContextMock.mockResolvedValue(stakeCtx);
    loadStakeAccountActiveMock.mockResolvedValue(true);
    const d = deps();

    const result = await runTransactionPropose(
      {
        draftToken: token({
          outputs: [],
          certificates: [{ kind: "RegisterStake" }, { kind: "DelegateStake", poolId: "f".repeat(56) }],
        }),
      },
      ctx,
      d,
    );

    expect(loadStakeAccountActiveMock).toHaveBeenCalledTimes(1);
    expect(validateOrThrowMock).toHaveBeenCalledWith(expect.anything(), stakeCtx, [], true, undefined);
    const validateOrder = validateOrThrowMock.mock.invocationCallOrder[0]!;
    const lookupOrder = loadStakeAccountActiveMock.mock.invocationCallOrder[0]!;
    expect(lookupOrder).toBeLessThan(validateOrder);
    // Nothing was added: the token already carried the registration.
    const [validatedDraft] = validateOrThrowMock.mock.calls[0]!;
    expect(validatedDraft.certificates.map((c: { kind: string }) => c.kind)).toEqual(["RegisterStake", "DelegateStake"]);
    expect(result.body).toMatchObject({ txHashChanged: false, txHashChangeReasons: [] });
  });

  it("re-checks the DRep registration at propose time and refuses a retired DRep's vote before pinning", async () => {
    // Retired since the preview: the fresh state reaches validation, which
    // refuses (vote-drep-unregistered — a validate.ts unit test); here the
    // stub does the refusing so the order and the side effects are checked.
    const { TxReviewError } = jest.requireActual("@/lib/tx-review/context") as typeof import("@/lib/tx-review/context");
    loadDrepRegisteredMock.mockResolvedValue(false);
    validateOrThrowMock.mockImplementation((_draft, _ctx, _utxos, _stake, registered) => {
      if (registered === false) {
        throw new TxReviewError(400, "INVALID_DRAFT", "The transaction cannot be built: not registered as a DRep", {
          issues: [{ level: "error", code: "vote-drep-unregistered", message: "not registered as a DRep" }],
        });
      }
      return [];
    });
    const d = deps();

    const result = await runTransactionPropose(
      {
        draftToken: token({
          outputs: [],
          votes: [{ govActionTxHash: PROPOSAL_HASH, govActionIndex: 0, voteKind: "Yes", rationale: "r" }],
        }),
      },
      ctx,
      d,
    );

    expect(loadDrepRegisteredMock).toHaveBeenCalledWith(
      walletCtx,
      expect.objectContaining({ votes: [expect.objectContaining({ govActionIndex: 0 })] }),
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: "INVALID_DRAFT", issues: [{ code: "vote-drep-unregistered" }] });
    // Refused before the rationale went public and before anything was stored.
    expect(d.pin).not.toHaveBeenCalled();
    expect(d.createPending).not.toHaveBeenCalled();
    expect(result.images).toBeUndefined();
  });

  it("adds a registration if the account was deregistered since the preview, and says so", async () => {
    const { STAKE_REGISTRATION_ADDED_WARNING } = jest.requireActual("@/lib/tx-review/pipeline") as typeof import("@/lib/tx-review/pipeline");
    loadReviewWalletContextMock.mockResolvedValue({
      ...walletCtx,
      stake: { rewardAddress: "stake_test1uqx", stakeScriptCbor: "8202" },
    });
    loadStakeAccountActiveMock.mockResolvedValue(false);
    buildUnsignedMock.mockResolvedValue({
      unsignedTx: "84a4",
      body: builtBody,
      txHash: "d00d",
      fee: "1",
      sizeBytes: 2,
      inputCount: 1,
      outputCount: 1,
    });
    const d = deps();

    const result = await runTransactionPropose(
      { draftToken: token({ outputs: [], certificates: [{ kind: "DelegateStake", poolId: "f".repeat(56) }] }) },
      ctx,
      d,
    );

    expect(result.status).toBe(201);
    const [validatedDraft] = validateOrThrowMock.mock.calls[0]!;
    expect(validatedDraft.certificates.map((c: { kind: string }) => c.kind)).toEqual(["RegisterStake", "DelegateStake"]);
    expect(result.body).toMatchObject({ txHashChanged: true, txHashChangeReasons: ["stake-registration"] });
    expect(summarizeForWalletMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      // Zero intended payments: the built body's only output is change.
      expect.objectContaining({ warnings: [STAKE_REGISTRATION_ADDED_WARNING], paymentCount: 0 }),
    );
  });

  it("stamps extra txJson namespaces, forwards the after-create hook with the claims, and labels the surface", async () => {
    // The web app's task payout runs this same function: it adds a `tasks`
    // namespace, links tasks inside the insert transaction, and audits as
    // "app". None of that changes what the token binds.
    const afterCreate = jest.fn<(...args: any[]) => Promise<void>>().mockResolvedValue(undefined);
    const d = deps({
      via: "app",
      omitCard: true,
      txJsonExtras: (claims: { jti: string }) => ({ tasks: { taskIds: ["t1"], draft: claims.jti } }),
      afterCreate,
    });
    const result = await runTransactionPropose({ draftToken: token() }, ctx, d);

    expect(result.status).toBe(201);
    const args = d.createPending.mock.calls[0]![1];
    expect(args.txJson.tasks).toEqual({ taskIds: ["t1"], draft: args.txJson.mcp.draftId });
    expect(args.txJson.multisig).toBeUndefined();
    // The persistence helper receives a hook bound to this token's claims.
    expect(typeof args.afterCreate).toBe("function");
    await args.afterCreate({ tx: true }, { id: "tx-new", walletId: "wallet-1" });
    expect(afterCreate).toHaveBeenCalledWith(
      { tx: true },
      { id: "tx-new" },
      expect.objectContaining({ jti: args.txJson.mcp.draftId, walletId: "wallet-1" }),
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ metadata: expect.objectContaining({ via: "app" }) }),
    );
    // omitCard: no PNG rendered, no image block, the hint says so.
    expect(renderCardMock).not.toHaveBeenCalled();
    expect(result.images).toBeUndefined();
    expect((result.body as Record<string, unknown>).reviewCard).toEqual({ attached: false, inline: true });
    expect((result.body as Record<string, unknown>).summary).toBeDefined();
  });

  it("follows the card mode the preview was delivered in", async () => {
    // The human confirmed an html-mode card (drawn by the inline view), so
    // the propose result stays html: no PNG, inline hint, inline text opener.
    // Propose takes nothing but the token, so the mode must ride inside it.
    const d = deps();
    const t = token({}, "beef", "html");
    const result = await runTransactionPropose({ draftToken: t }, ctx, d);

    expect(result.status).toBe(201);
    expect(renderCardMock).not.toHaveBeenCalled();
    expect(result.images).toBeUndefined();
    expect((result.body as Record<string, unknown>).reviewCard).toEqual({ attached: false, inline: true });
    expect(result.text).toContain('call the tool again with card: "image"');
    expect(result.text).not.toContain("attached as an image");

    // The replay of an html token is html too.
    const draftId = (d.createPending.mock.calls[0]![1] as { txJson: { mcp: { draftId: string } } }).txJson.mcp.draftId;
    const replayDeps = deps({
      db: makeDb([{ id: "tx-first", txJson: JSON.stringify({ ...builtBody, mcp: { draftId } }) }]),
    });
    const replay = await runTransactionPropose({ draftToken: t }, ctx, replayDeps);
    expect(replay.status).toBe(200);
    expect(replay.images).toBeUndefined();
    expect(renderCardMock).not.toHaveBeenCalled();
  });

  it("passes no hook through and audits as mcp by default", async () => {
    const d = deps();
    await runTransactionPropose({ draftToken: token() }, ctx, d);
    expect(d.createPending.mock.calls[0]![1].afterCreate).toBeUndefined();
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ metadata: expect.objectContaining({ via: "mcp" }) }),
    );
  });

  it("turns a review error thrown by the persistence step into a readable result", async () => {
    // The task hooks throw TxReviewError from inside the insert transaction
    // (tasks changed since the preview); the row is rolled back by the
    // helper, and here the error must become a 409 result, not a crash.
    const { TxReviewError } = jest.requireActual("@/lib/tx-review/context") as typeof import("@/lib/tx-review/context");
    const d = deps({
      createPending: jest.fn<() => Promise<never>>().mockRejectedValue(
        new TxReviewError(409, "TASK_CHANGED", "A task changed. Preview again."),
      ),
    });
    const result = await runTransactionPropose({ draftToken: token() }, ctx, d);
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ code: "TASK_CHANGED" });
    expect(auditMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "transaction.create" }),
    );
  });

  it("refuses a broadcast result from the persistence helper", async () => {
    // Cannot happen with an empty signer set, but the guard must hold.
    const d = deps({ createPending: jest.fn<() => Promise<string>>().mockResolvedValue("submitted-hash") });
    await expect(runTransactionPropose({ draftToken: token() }, ctx, d)).rejects.toThrow(
      /Unexpected persistence result/,
    );
  });
});
