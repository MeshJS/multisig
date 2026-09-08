import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PrismaClient } from "@prisma/client";

import type { McpCaller } from "@/lib/mcp/auth";
import type { ToolContext } from "@/lib/mcp/tools";
import type { TxReviewSummary } from "@/lib/tx-review/summary";

/**
 * `transaction_preview` orchestration: builds and renders, persists nothing,
 * and mints a token bound to the caller and the exact normalized spec.
 */

const loadReviewWalletContextMock = jest.fn<(...args: any[]) => Promise<any>>();
const loadSpendableUtxosMock = jest.fn<(...args: any[]) => Promise<any>>();
const loadSpecAssetMetadataMock = jest.fn<(...args: any[]) => Promise<any>>();
const validateOrThrowMock = jest.fn<(...args: any[]) => any>();
const loadStakeAccountActiveMock = jest.fn<(...args: any[]) => Promise<boolean | undefined>>();
const buildUnsignedMock = jest.fn<(...args: any[]) => Promise<any>>();
const summarizeForWalletMock = jest.fn<(...args: any[]) => Promise<any>>();
const renderCardMock = jest.fn<(...args: any[]) => Promise<any>>();

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
    buildUnsigned: buildUnsignedMock,
    summarizeForWallet: summarizeForWalletMock,
    renderCard: renderCardMock,
  };
});

const SUBJECT = "addr_test1qpsubject";
const CLIENT = "https://claude.ai/x";

const caller: McpCaller = {
  subject: SUBJECT,
  addresses: [SUBJECT],
  scopes: ["transactions:write"],
  clientName: CLIENT,
  botId: null,
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
};
const ctx: ToolContext = { caller, clientIp: "127.0.0.1" };

const walletCtx = {
  walletRow: {
    id: "wallet-1",
    name: "Treasury",
    signersAddresses: [SUBJECT],
    signersDescriptions: ["Me"],
    numRequiredSigners: 1,
    type: "all",
  },
  network: 0 as const,
  walletAddress: "addr_test1qpwallet",
  scriptCbor: "8200",
  drep: undefined,
  stake: undefined,
  threshold: { required: 1, total: 1, type: "all" },
};

const HOSKY = `${"a".repeat(56)}484f534b59`;

let runTransactionPreview: typeof import("@/lib/tx-review/preview").runTransactionPreview;
let verifyDraftToken: typeof import("@/lib/tx-review/draft-token").verifyDraftToken;

const db = {
  transaction: { create: jest.fn(), findMany: jest.fn() },
} as unknown as PrismaClient;

function deps() {
  return {
    db,
    fetchFreeUtxos: jest.fn<() => Promise<any>>().mockResolvedValue({ status: 200, body: [] }),
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  ({ runTransactionPreview } = await import("@/lib/tx-review/preview"));
  ({ verifyDraftToken } = await import("@/lib/tx-review/draft-token"));
  loadReviewWalletContextMock.mockResolvedValue(walletCtx);
  loadSpendableUtxosMock.mockResolvedValue([]);
  loadSpecAssetMetadataMock.mockResolvedValue({
    metadata: {},
    decimalsFor: (unit: string) => (unit === HOSKY ? 0 : undefined),
  });
  validateOrThrowMock.mockReturnValue([
    { level: "warning", code: "min-ada-topup", message: "Token-only output — min ADA will be added." },
  ]);
  loadStakeAccountActiveMock.mockResolvedValue(undefined);
  buildUnsignedMock.mockResolvedValue({
    unsignedTx: "84a4",
    body: { outputs: [], inputs: [], fee: "170000" },
    txHash: "beef",
    fee: "170000",
    sizeBytes: 2,
    inputCount: 1,
    outputCount: 1,
  });
  const fakeSummary: TxReviewSummary = {
    kind: "preview",
    wallet: { id: "wallet-1", name: "Treasury", address: "addr_test1qpwallet", network: "preprod" },
    threshold: { required: 1, total: 1, type: "all" },
    signatures: { signed: [], rejected: [], remaining: 1 },
    description: "Pay",
    metadataMessage: "",
    recipients: [],
    change: [],
    inputs: { count: 1, total: [], unresolved: 0 },
    fee: null,
    deposit: null,
    actions: [],
    txHash: "beef",
    warnings: [],
    generatedAt: "2026-09-07T12:00:00.000Z",
  };
  summarizeForWalletMock.mockResolvedValue(fakeSummary);
  renderCardMock.mockResolvedValue({ data: "AAAA", mimeType: "image/png" });
});

describe("transaction_preview", () => {
  it("builds, renders, persists nothing, and mints a token bound to the caller", async () => {
    const d = deps();
    const result = await runTransactionPreview(
      {
        walletId: "wallet-1",
        outputs: [{ address: "addr_test1qpx", ada: "2.5", assets: [{ unit: HOSKY, quantity: "10" }] }],
        description: "Pay",
      },
      ctx,
      d,
    );

    expect(result.status).toBe(200);
    expect(result.images).toEqual([{ data: "AAAA", mimeType: "image/png" }]);
    expect(typeof result.text).toBe("string");
    expect((db.transaction as unknown as { create: jest.Mock }).create).not.toHaveBeenCalled();

    const body = result.body as Record<string, unknown>;
    expect(body).toMatchObject({ txHash: "beef", fee: "170000", persisted: false, signed: false, broadcast: false });
    expect(body.warnings).toEqual(["Token-only output — min ADA will be added."]);

    const verified = verifyDraftToken(String(body.draftToken), { subject: SUBJECT, clientId: CLIENT });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.claims.walletId).toBe("wallet-1");
    expect(verified.claims.previewTxHash).toBe("beef");
    // The token carries base units, not what the model typed.
    expect(verified.claims.spec.outputs[0]!.assets).toEqual([
      { unit: "lovelace", quantity: "2500000" },
      { unit: HOSKY, quantity: "10" },
    ]);
    expect(result.audit).toEqual({ walletId: "wallet-1", previewTxHash: "beef" });
    // Built with a fresh UTxO set for that wallet.
    expect(loadSpendableUtxosMock).toHaveBeenCalledWith(d, "wallet-1");
    // The summary learns how many outputs were intended, so change is never mistaken for a recipient.
    expect(summarizeForWalletMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ kind: "preview", paymentCount: 1 }),
    );
  });

  it("returns spec problems as a 400 the model can relay, before touching the chain", async () => {
    const result = await runTransactionPreview(
      { walletId: "wallet-1", outputs: [{ address: "addr_test1qpx", ada: "abc" }] },
      ctx,
      deps(),
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: "INVALID_SPEC", issues: [{ code: "invalid-amount" }] });
    expect(loadSpendableUtxosMock).not.toHaveBeenCalled();
    expect(buildUnsignedMock).not.toHaveBeenCalled();
    expect(result.images).toBeUndefined();
  });

  it("adds the stake registration for an unregistered credential and mints the token from it", async () => {
    const { STAKE_REGISTRATION_ADDED_WARNING } = jest.requireActual("@/lib/tx-review/pipeline") as typeof import("@/lib/tx-review/pipeline");
    const stakeCtx = { ...walletCtx, stake: { rewardAddress: "stake_test1uqx", stakeScriptCbor: "8202" } };
    loadReviewWalletContextMock.mockResolvedValue(stakeCtx);
    loadStakeAccountActiveMock.mockResolvedValue(false);
    validateOrThrowMock.mockReturnValue([]);

    const result = await runTransactionPreview(
      { walletId: "wallet-1", certificates: [{ kind: "DelegateStake", poolId: "f".repeat(56) }] },
      ctx,
      deps(),
    );

    expect(loadStakeAccountActiveMock).toHaveBeenCalledWith(
      stakeCtx,
      expect.objectContaining({ certificates: [expect.objectContaining({ kind: "DelegateStake" })] }),
    );
    // Validation and the build see register-first; the state still reaches validation.
    const [validatedDraft, , , active] = validateOrThrowMock.mock.calls[0]!;
    expect(validatedDraft.certificates.map((c: { kind: string }) => c.kind)).toEqual(["RegisterStake", "DelegateStake"]);
    expect(active).toBe(false);
    expect(buildUnsignedMock.mock.calls[0]![0]).toBe(validatedDraft);

    const body = result.body as Record<string, unknown>;
    expect(body.warnings).toEqual([STAKE_REGISTRATION_ADDED_WARNING]);
    // The token carries the completed spec, so propose recreates the same deposit.
    const verified = verifyDraftToken(String(body.draftToken), { subject: SUBJECT, clientId: CLIENT });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    // Pool ids are canonical bech32 in the spec, so match the kind and shape.
    expect(verified.claims.spec.certificates).toEqual([
      { kind: "RegisterStake" },
      { kind: "DelegateStake", poolId: expect.stringMatching(/^pool1/) },
    ]);
  });

  it("leaves a registered credential's delegation alone", async () => {
    loadReviewWalletContextMock.mockResolvedValue({
      ...walletCtx,
      stake: { rewardAddress: "stake_test1uqx", stakeScriptCbor: "8202" },
    });
    loadStakeAccountActiveMock.mockResolvedValue(true);
    validateOrThrowMock.mockReturnValue([]);

    const result = await runTransactionPreview(
      { walletId: "wallet-1", certificates: [{ kind: "DelegateStake", poolId: "f".repeat(56) }] },
      ctx,
      deps(),
    );

    const [validatedDraft, , , active] = validateOrThrowMock.mock.calls[0]!;
    expect(validatedDraft.certificates.map((c: { kind: string }) => c.kind)).toEqual(["DelegateStake"]);
    expect(active).toBe(true);
    expect((result.body as { warnings: string[] }).warnings).toEqual([]);
  });

  it("surfaces a failed registration lookup instead of building blind", async () => {
    const { TxReviewError } = jest.requireActual("@/lib/tx-review/context") as typeof import("@/lib/tx-review/context");
    loadStakeAccountActiveMock.mockRejectedValue(
      new TxReviewError(502, "STAKE_LOOKUP_FAILED", "Could not check whether the wallet's stake credential is registered: down"),
    );
    const result = await runTransactionPreview(
      { walletId: "wallet-1", certificates: [{ kind: "DelegateStake", poolId: "f".repeat(56) }] },
      ctx,
      deps(),
    );
    expect(result.status).toBe(502);
    expect((result.body as { code: string }).code).toBe("STAKE_LOOKUP_FAILED");
    expect(buildUnsignedMock).not.toHaveBeenCalled();
  });

  it("passes wallet-context failures through as tool errors", async () => {
    const { TxReviewError } = jest.requireActual("@/lib/tx-review/context") as typeof import("@/lib/tx-review/context");
    loadReviewWalletContextMock.mockRejectedValue(new TxReviewError(403, "NOT_SIGNER", "Not authorized for this wallet"));
    const result = await runTransactionPreview(
      { walletId: "wallet-1", outputs: [{ address: "addr_test1qpx", ada: "1" }] },
      ctx,
      deps(),
    );
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: "Not authorized for this wallet", code: "NOT_SIGNER" });
  });
});
