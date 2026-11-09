import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMockResponse, makeBearerAuth, makeBotJwtPayload } from "./apiTestUtils";
import {
  MAX_PROXY_VOTES_PER_TX,
  canonicalProposalId,
  validateProxyVotes,
} from "@/lib/proxy/voteInput";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("canonicalProposalId", () => {
  it("accepts <64-hex txHash>#<index> and returns lowercase hash, plain index", () => {
    expect(canonicalProposalId(`${HASH_A}#0`)).toBe(`${HASH_A}#0`);
    expect(canonicalProposalId(`${"AB".repeat(32)}#7`)).toBe(`${"ab".repeat(32)}#7`);
    expect(canonicalProposalId(`  ${HASH_A}#007 `)).toBe(`${HASH_A}#7`);
    expect(canonicalProposalId(`${HASH_A}#65535`)).toBe(`${HASH_A}#65535`);
  });

  it("rejects ids that cannot name a governance action", () => {
    for (const id of [
      "abc#0", // too short to be a tx hash
      `${"a".repeat(63)}g#0`, // non-hex
      `${HASH_A}a#0`, // 65 chars
      `${HASH_A}#`, // the shared parser reads an empty index as 0
      `${HASH_A}#-1`,
      `${HASH_A}#1e0`,
      `${HASH_A}#0x1`,
      `${HASH_A}# 1`,
      `${HASH_A}#1.0`,
      `${HASH_A}#65536`, // index is uint .size 2
      `${HASH_A}#0#1`,
      HASH_A,
      "",
    ]) {
      expect(canonicalProposalId(id)).toBeNull();
    }
  });
});

describe("validateProxyVotes", () => {
  it("normalizes proposal ids and keeps voteKind and metadata", () => {
    expect(
      validateProxyVotes([
        { proposalId: `${HASH_A.toUpperCase()}#01`, voteKind: "Yes", metadata: { note: "x" } },
        { proposalId: `${HASH_B}#2`, voteKind: "Abstain" },
      ]),
    ).toEqual([
      { proposalId: `${HASH_A}#1`, voteKind: "Yes", metadata: { note: "x" } },
      { proposalId: `${HASH_B}#2`, voteKind: "Abstain", metadata: undefined },
    ]);
  });

  it("rejects a missing or empty votes array", () => {
    expect(validateProxyVotes(undefined)).toEqual({ error: "votes must be a non-empty array" });
    expect(validateProxyVotes([])).toEqual({ error: "votes must be a non-empty array" });
    expect(validateProxyVotes({ proposalId: `${HASH_A}#0` })).toEqual({
      error: "votes must be a non-empty array",
    });
  });

  it("rejects the same governance action twice, even when spelled differently", () => {
    const result = validateProxyVotes([
      { proposalId: `${HASH_A}#1`, voteKind: "Yes" },
      { proposalId: `${HASH_B}#0`, voteKind: "No" },
      { proposalId: `${HASH_A.toUpperCase()}#001`, voteKind: "No" },
    ]);
    expect(result).toEqual({
      error: expect.stringContaining(`votes[2] repeats proposal ${HASH_A}#1`),
    });
  });

  it("allows different actions from the same proposal transaction", () => {
    const result = validateProxyVotes([
      { proposalId: `${HASH_A}#0`, voteKind: "Yes" },
      { proposalId: `${HASH_A}#1`, voteKind: "No" },
    ]);
    expect(Array.isArray(result) && result.length).toBe(2);
  });

  it("names the offending entry for malformed ids, kinds and non-object entries", () => {
    expect(validateProxyVotes([{ proposalId: `${HASH_A}#0`, voteKind: "Yes" }, { voteKind: "Yes" }])).toEqual({
      error: "votes[1] requires proposalId",
    });
    expect(validateProxyVotes(["oops"])).toEqual({ error: "votes[0] requires proposalId" });
    expect(validateProxyVotes([null])).toEqual({ error: "votes[0] requires proposalId" });
    expect(validateProxyVotes([{ proposalId: "abc#0", voteKind: "Yes" }])).toEqual({
      error: expect.stringContaining("votes[0].proposalId must be <txHash>#<index>"),
    });
    expect(validateProxyVotes([{ proposalId: `${HASH_A}#0`, voteKind: "yes" }])).toEqual({
      error: "votes[0].voteKind must be Yes, No, or Abstain",
    });
  });

  it("caps the number of votes at what could fit in one transaction", () => {
    const votes = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ proposalId: `${HASH_A}#${i}`, voteKind: "Yes" }));
    expect(Array.isArray(validateProxyVotes(votes(MAX_PROXY_VOTES_PER_TX)))).toBe(true);
    expect(validateProxyVotes(votes(MAX_PROXY_VOTES_PER_TX + 1))).toEqual({
      error: expect.stringContaining(`at most ${MAX_PROXY_VOTES_PER_TX}`),
    });
  });
});

describe("why duplicates must be rejected before building", () => {
  // The endpoint builds with the CSL serializer (getTxBuilder(network, true)).
  // Voting procedures are a map keyed by (voter, action), so a second vote on
  // the same action does not error there — it silently replaces the first, and
  // the transaction casts fewer votes than the request asked for.
  it("the CSL serializer keeps only the last of two votes on one action", () => {
    const { MeshTxBuilder } = jest.requireActual<typeof import("@meshsdk/core")>("@meshsdk/core");
    const { CSLSerializer } = jest.requireActual<typeof import("@meshsdk/core-csl")>("@meshsdk/core-csl");
    const addr = "addr_test1vqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygxrcya6";
    const drepId = "drep1ygqgayvx8yzsaj9hprja3l6jy3v4px9z3u8uvecuvm3f92ce7mckx";
    const build = (kinds: Array<"Yes" | "No">) => {
      const tb = new MeshTxBuilder({ serializer: new CSLSerializer() });
      tb.setNetwork("preprod");
      tb.txIn(HASH_B, 0, [{ unit: "lovelace", quantity: "100000000" }], addr);
      for (const voteKind of kinds) {
        tb.vote({ type: "DRep", drepId }, { txHash: HASH_A, txIndex: 0 }, { voteKind });
      }
      tb.changeAddress(addr);
      return tb.completeSync();
    };
    expect(build(["Yes", "No"])).toBe(build(["No"]));
    expect(build(["Yes", "No"])).not.toBe(build(["Yes"]));
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/proxyVote — validation happens before any authorization or chain
// work, and what reaches the builder and the stored txJson is the canonical id.
// ---------------------------------------------------------------------------

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => boolean>();
const applyBotRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, botId: string) => boolean>();
const enforceBodySizeMock = jest.fn<(req: NextApiRequest, res: NextApiResponse, maxBytes: number) => boolean>();
const verifyJwtMock: jest.Mock = jest.fn();
const isBotJwtMock: jest.Mock = jest.fn();
const authorizeWalletSignerForV1TxMock: jest.Mock = jest.fn();
const loadActiveProxyForWalletMock: jest.Mock = jest.fn();
const resolveWalletScriptAddressMock: jest.Mock = jest.fn();
const resolveUtxoRefsFromChainMock: jest.Mock = jest.fn();
const loadBlockedUtxoRefsForWalletMock: jest.Mock = jest.fn();
const resolveCollateralRefFromChainMock: jest.Mock = jest.fn();
const selectAuthTokenUtxoMock: jest.Mock = jest.fn();
const getTxBuilderMock: jest.Mock = jest.fn();
const buildProxyVoteTxMock: jest.Mock = jest.fn();
const deriveProxyScriptsMock: jest.Mock = jest.fn();
const proxyStakeCredentialFromAddressMock: jest.Mock = jest.fn();
const completeTxWithFreshCostModelsMock: jest.Mock = jest.fn();
const auditBuiltProxyTxMock: jest.Mock = jest.fn();
const createPendingMultisigTransactionMock: jest.Mock = jest.fn();

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: corsMock,
}));
jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: applyRateLimitMock,
  applyBotRateLimit: applyBotRateLimitMock,
  enforceBodySize: enforceBodySizeMock,
}));
jest.mock("@/lib/verifyJwt", () => ({
  __esModule: true,
  verifyJwt: verifyJwtMock,
  isBotJwt: isBotJwtMock,
}));
jest.mock("@/server/db", () => ({ __esModule: true, db: {} }));
jest.mock("@/lib/server/v1WalletAuth", () => ({
  __esModule: true,
  authorizeWalletSignerForV1Tx: authorizeWalletSignerForV1TxMock,
}));
jest.mock("@/lib/server/proxyAccess", () => ({
  __esModule: true,
  loadActiveProxyForWallet: loadActiveProxyForWalletMock,
}));
jest.mock("@/lib/server/walletScriptAddress", () => ({
  __esModule: true,
  resolveWalletScriptAddress: resolveWalletScriptAddressMock,
}));
jest.mock("@/lib/server/resolveUtxoRefsFromChain", () => ({
  __esModule: true,
  resolveUtxoRefsFromChain: resolveUtxoRefsFromChainMock,
}));
jest.mock("@/lib/server/proxyUtxos", () => ({
  __esModule: true,
  loadBlockedUtxoRefsForWallet: loadBlockedUtxoRefsForWalletMock,
  resolveCollateralRefFromChain: resolveCollateralRefFromChainMock,
}));
jest.mock("@/lib/proxy/utxoUtils", () => ({
  __esModule: true,
  selectAuthTokenUtxo: selectAuthTokenUtxoMock,
}));
jest.mock("@/utils/get-tx-builder", () => ({
  __esModule: true,
  getTxBuilder: getTxBuilderMock,
}));
jest.mock("@/lib/server/proxyTxBuilders", () => ({
  __esModule: true,
  buildProxyVoteTx: buildProxyVoteTxMock,
  deriveProxyScripts: deriveProxyScriptsMock,
  proxyStakeCredentialFromAddress: proxyStakeCredentialFromAddressMock,
}));
jest.mock("@/lib/server/completeTxWithFreshCostModels", () => ({
  __esModule: true,
  completeTxWithFreshCostModels: completeTxWithFreshCostModelsMock,
}));
jest.mock("@/lib/server/proxyAuthTokenAudit", () => ({
  __esModule: true,
  auditBuiltProxyTx: auditBuiltProxyTxMock,
}));
jest.mock("@/lib/server/createPendingMultisigTransaction", () => ({
  __esModule: true,
  createPendingMultisigTransaction: createPendingMultisigTransactionMock,
}));

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/proxyVote"));
});

beforeEach(() => {
  jest.clearAllMocks();
  applyRateLimitMock.mockReturnValue(true);
  applyBotRateLimitMock.mockReturnValue(true);
  enforceBodySizeMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
  verifyJwtMock.mockReturnValue(makeBotJwtPayload());
  isBotJwtMock.mockReturnValue(true);
  (authorizeWalletSignerForV1TxMock as any).mockResolvedValue({
    wallet: { scriptCbor: "script", numRequiredSigners: 2, type: "all" },
  });
  (loadActiveProxyForWalletMock as any).mockResolvedValue({
    paramUtxo: JSON.stringify({ txHash: "cc", outputIndex: 0 }),
    proxyAddress: "addr_test_proxy",
    authTokenId: "policy",
  });
  proxyStakeCredentialFromAddressMock.mockReturnValue(undefined);
  deriveProxyScriptsMock.mockReturnValue({ authTokenId: "policy", proxyAddress: "addr_test_proxy" });
  resolveWalletScriptAddressMock.mockReturnValue("addr_test_wallet_script");
  (resolveUtxoRefsFromChainMock as any).mockResolvedValue({ utxos: [{ input: { txHash: "aa", outputIndex: 0 } }] });
  (loadBlockedUtxoRefsForWalletMock as any).mockResolvedValue(new Set());
  selectAuthTokenUtxoMock.mockReturnValue({ input: { txHash: "aa", outputIndex: 0 } });
  (resolveCollateralRefFromChainMock as any).mockResolvedValue({ collateral: { input: { txHash: "bb", outputIndex: 1 } } });
  (getTxBuilderMock as any).mockResolvedValue({ meshTxBuilderBody: {} });
  buildProxyVoteTxMock.mockReturnValue({ dRepId: "drep_script1test" });
  (completeTxWithFreshCostModelsMock as any).mockResolvedValue("tx-cbor");
  auditBuiltProxyTxMock.mockReturnValue(null);
  (createPendingMultisigTransactionMock as any).mockResolvedValue({ id: "tx-1" });
});

function voteRequest(votes: unknown): NextApiRequest {
  return {
    method: "POST",
    headers: makeBearerAuth(),
    body: {
      walletId: "wallet-1",
      address: makeBotJwtPayload().address,
      proxyId: "proxy-1",
      votes,
      utxoRefs: [{ txHash: "aa", outputIndex: 0 }],
      collateralRef: { txHash: "bb", outputIndex: 1 },
    },
  } as unknown as NextApiRequest;
}

describe("proxyVote bot API", () => {
  it("rejects a repeated governance action with 400 before authorization or chain lookups", async () => {
    const res = createMockResponse();
    await handler(
      voteRequest([
        { proposalId: `${HASH_A}#0`, voteKind: "Yes" },
        { proposalId: `${HASH_A}#00`, voteKind: "No" },
      ]),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(authorizeWalletSignerForV1TxMock).not.toHaveBeenCalled();
    expect(resolveUtxoRefsFromChainMock).not.toHaveBeenCalled();
    expect(buildProxyVoteTxMock).not.toHaveBeenCalled();
  });

  it("rejects a txHash that is not 64 hex characters with 400 instead of failing in the builder", async () => {
    const res = createMockResponse();
    await handler(voteRequest([{ proposalId: "deadbeef#0", voteKind: "Yes" }]), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(resolveUtxoRefsFromChainMock).not.toHaveBeenCalled();
    expect(completeTxWithFreshCostModelsMock).not.toHaveBeenCalled();
  });

  it("builds and stores the canonical proposal ids", async () => {
    const res = createMockResponse();
    await handler(
      voteRequest([
        { proposalId: `${HASH_A.toUpperCase()}#01`, voteKind: "Yes" },
        { proposalId: `${HASH_B}#2`, voteKind: "No" },
      ]),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const expectedVotes = [
      { proposalId: `${HASH_A}#1`, voteKind: "Yes", metadata: undefined },
      { proposalId: `${HASH_B}#2`, voteKind: "No", metadata: undefined },
    ];
    expect(buildProxyVoteTxMock).toHaveBeenCalledWith(
      expect.objectContaining({ votes: expectedVotes }),
    );
    expect(createPendingMultisigTransactionMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        txJson: expect.objectContaining({
          proxyBot: { kind: "proxyVote", proxyId: "proxy-1", dRepId: "drep_script1test", votes: expectedVotes },
        }),
      }),
    );
  });
});
