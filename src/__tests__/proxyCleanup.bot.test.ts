import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { UTxO } from "@meshsdk/core";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMockResponse, makeBearerAuth, makeBotJwtPayload } from "./apiTestUtils";

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
const resolveCollateralRefFromChainMock: jest.Mock = jest.fn();
const resolveSingleUtxoRefFromChainMock: jest.Mock = jest.fn();
const requireAuthTokenUtxoMock: jest.Mock = jest.fn();
const loadBlockedUtxoRefsForWalletMock: jest.Mock = jest.fn();
const selectAuthTokenUtxoMock: jest.Mock = jest.fn();
const buildProxyCleanupSweepTxMock: jest.Mock = jest.fn();
const buildProxyCleanupTxMock: jest.Mock = jest.fn();
const deriveProxyScriptsMock: jest.Mock = jest.fn();
const createPendingMultisigTransactionMock: jest.Mock = jest.fn();
const completeTxWithFreshCostModelsMock: jest.Mock = jest.fn();
const completeMock: jest.Mock = jest.fn();
const getTxBuilderMock: jest.Mock = jest.fn();
const fetchAddressUTxOsMock: jest.Mock = jest.fn();

const proxy = {
  id: "proxy-1",
  proxyAddress: "addr_test_proxy",
  authTokenId: "policy",
  paramUtxo: JSON.stringify({ txHash: "aa", outputIndex: 0 }),
};

const proxyUtxo = {
  input: { txHash: "cc", outputIndex: 2 },
  output: { address: proxy.proxyAddress, amount: [{ unit: "lovelace", quantity: "2000000" }] },
} as UTxO;

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: corsMock,
}), { virtual: true });

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: applyRateLimitMock,
  applyBotRateLimit: applyBotRateLimitMock,
  enforceBodySize: enforceBodySizeMock,
}), { virtual: true });

jest.mock("@/lib/verifyJwt", () => ({
  __esModule: true,
  verifyJwt: verifyJwtMock,
  isBotJwt: isBotJwtMock,
}), { virtual: true });

jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {},
}), { virtual: true });

jest.mock("@/lib/server/v1WalletAuth", () => ({
  __esModule: true,
  authorizeWalletSignerForV1Tx: authorizeWalletSignerForV1TxMock,
}), { virtual: true });

jest.mock("@/lib/server/proxyAccess", () => ({
  __esModule: true,
  loadActiveProxyForWallet: loadActiveProxyForWalletMock,
}), { virtual: true });

jest.mock("@/lib/server/walletScriptAddress", () => ({
  __esModule: true,
  resolveWalletScriptAddress: resolveWalletScriptAddressMock,
}), { virtual: true });

jest.mock("@/lib/server/resolveUtxoRefsFromChain", () => ({
  __esModule: true,
  resolveUtxoRefsFromChain: resolveUtxoRefsFromChainMock,
}), { virtual: true });

jest.mock("@/lib/server/proxyUtxos", () => ({
  __esModule: true,
  requireAuthTokenUtxo: requireAuthTokenUtxoMock,
  loadBlockedUtxoRefsForWallet: loadBlockedUtxoRefsForWalletMock,
  resolveCollateralRefFromChain: resolveCollateralRefFromChainMock,
  resolveSingleUtxoRefFromChain: resolveSingleUtxoRefFromChainMock,
}), { virtual: true });

jest.mock("@/lib/proxy/utxoUtils", () => ({
  __esModule: true,
  selectAuthTokenUtxo: selectAuthTokenUtxoMock,
}), { virtual: true });

jest.mock("@/lib/server/createPendingMultisigTransaction", () => ({
  __esModule: true,
  createPendingMultisigTransaction: createPendingMultisigTransactionMock,
}), { virtual: true });

jest.mock("@/lib/server/completeTxWithFreshCostModels", () => ({
  __esModule: true,
  completeTxWithFreshCostModels: completeTxWithFreshCostModelsMock,
}), { virtual: true });

jest.mock("@/utils/get-provider", () => ({
  __esModule: true,
  getProvider: () => ({ fetchAddressUTxOs: fetchAddressUTxOsMock }),
}), { virtual: true });

jest.mock("@/utils/get-tx-builder", () => ({
  __esModule: true,
  getTxBuilder: getTxBuilderMock,
}), { virtual: true });

jest.mock("@/lib/server/proxyTxBuilders", () => ({
  __esModule: true,
  buildProxyCleanupSweepTx: buildProxyCleanupSweepTxMock,
  buildProxyCleanupTx: buildProxyCleanupTxMock,
  deriveProxyScripts: deriveProxyScriptsMock,
}), { virtual: true });

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/proxyCleanup"));
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
  (loadActiveProxyForWalletMock as any).mockResolvedValue(proxy);
  resolveWalletScriptAddressMock.mockReturnValue("addr_test_wallet");
  (resolveUtxoRefsFromChainMock as any).mockResolvedValue({ utxos: [{ input: { txHash: "bb", outputIndex: 1 } }] });
  (resolveCollateralRefFromChainMock as any).mockResolvedValue({ collateral: { input: { txHash: "dd", outputIndex: 3 } } });
  requireAuthTokenUtxoMock.mockReturnValue({ input: { txHash: "bb", outputIndex: 1 } });
  (loadBlockedUtxoRefsForWalletMock as any).mockResolvedValue([]);
  selectAuthTokenUtxoMock.mockReturnValue({ input: { txHash: "bb", outputIndex: 1 } });
  deriveProxyScriptsMock.mockReturnValue({
    authTokenId: proxy.authTokenId,
    proxyAddress: proxy.proxyAddress,
  });
  buildProxyCleanupSweepTxMock.mockReturnValue({ sweptProxyUtxos: "1", preservedAuthTokens: "1" });
  buildProxyCleanupTxMock.mockReturnValue({ burnedAuthTokens: "10" });
  (completeMock as any).mockResolvedValue("tx-cbor");
  getTxBuilderMock.mockReturnValue({ complete: completeMock, meshTxBuilderBody: {} });
  (completeTxWithFreshCostModelsMock as any).mockResolvedValue("fresh-tx-cbor");
  (createPendingMultisigTransactionMock as any).mockResolvedValue({ id: "tx-1" });
});

function cleanupRequest(body: Record<string, unknown>): NextApiRequest {
  return {
    method: "POST",
    headers: makeBearerAuth(),
    body: {
      walletId: "wallet-1",
      address: makeBotJwtPayload().address,
      proxyId: proxy.id,
      utxoRefs: [{ txHash: "bb", outputIndex: 1 }],
      collateralRef: { txHash: "dd", outputIndex: 3 },
      ...body,
    },
  } as unknown as NextApiRequest;
}

describe("proxyCleanup bot API", () => {
  it("builds a sweep cleanup when proxy UTxOs remain", async () => {
    (fetchAddressUTxOsMock as any).mockResolvedValue([proxyUtxo]);
    const res = createMockResponse();

    await handler(cleanupRequest({}), res);

    expect(resolveCollateralRefFromChainMock).toHaveBeenCalledWith(
      expect.objectContaining({
        collateralRef: { txHash: "dd", outputIndex: 3 },
        expectedAddress: makeBotJwtPayload().address,
      }),
    );
    expect(buildProxyCleanupSweepTxMock).toHaveBeenCalledWith(
      expect.objectContaining({ proxyUtxos: [proxyUtxo] }),
    );
    expect(createPendingMultisigTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        proposerAddress: makeBotJwtPayload().address,
        txCbor: "fresh-tx-cbor",
        initialSignedAddresses: [],
      }),
    );
    expect(completeTxWithFreshCostModelsMock).toHaveBeenCalledWith(
      getTxBuilderMock.mock.results[0]?.value,
      0,
    );
    expect(completeMock).not.toHaveBeenCalled();
    expect(buildProxyCleanupTxMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      transaction: { id: "tx-1" },
      cleanup: { phase: "sweep", sweptProxyUtxos: "1", preservedAuthTokens: "1" },
    });
  });

  it("builds a burn cleanup when the proxy address is empty", async () => {
    (fetchAddressUTxOsMock as any).mockResolvedValue([]);
    const res = createMockResponse();

    await handler(cleanupRequest({}), res);

    expect(buildProxyCleanupTxMock).toHaveBeenCalled();
    expect(buildProxyCleanupSweepTxMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      transaction: { id: "tx-1" },
      cleanup: { phase: "burn", burnedAuthTokens: "10" },
    });
  });

  it("rejects explicit proxyUtxoRefs that omit visible proxy UTxOs", async () => {
    (fetchAddressUTxOsMock as any).mockResolvedValue([proxyUtxo]);
    const res = createMockResponse();

    await handler(
      cleanupRequest({ proxyUtxoRefs: [{ txHash: "ee", outputIndex: 4 }] }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(buildProxyCleanupSweepTxMock).not.toHaveBeenCalled();
  });
});
