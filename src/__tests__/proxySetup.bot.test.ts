import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
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
const resolveUtxoRefsFromChainMock: jest.Mock = jest.fn();
const resolveCollateralRefFromChainMock: jest.Mock = jest.fn();
const resolveWalletScriptAddressMock: jest.Mock = jest.fn();
const buildProxySetupTxMock: jest.Mock = jest.fn();
const createPendingMultisigTransactionMock: jest.Mock = jest.fn();
const completeMock: jest.Mock = jest.fn();
const getTxBuilderMock: jest.Mock = jest.fn();

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
  resolveCollateralRefFromChain: resolveCollateralRefFromChainMock,
}), { virtual: true });

jest.mock("@/lib/server/createPendingMultisigTransaction", () => ({
  __esModule: true,
  createPendingMultisigTransaction: createPendingMultisigTransactionMock,
}), { virtual: true });

jest.mock("@/utils/get-tx-builder", () => ({
  __esModule: true,
  getTxBuilder: getTxBuilderMock,
}), { virtual: true });

jest.mock("@/lib/server/proxyTxBuilders", () => ({
  __esModule: true,
  DEFAULT_PROXY_SETUP_LOVELACE: "1000000",
  buildProxySetupTx: buildProxySetupTxMock,
}), { virtual: true });

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/proxySetup"));
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
  resolveWalletScriptAddressMock.mockReturnValue("addr_test_wallet_script");
  (resolveUtxoRefsFromChainMock as any).mockResolvedValue({ utxos: [{ input: { txHash: "aa", outputIndex: 0 } }] });
  (resolveCollateralRefFromChainMock as any).mockResolvedValue({ collateral: { input: { txHash: "bb", outputIndex: 1 } } });
  buildProxySetupTxMock.mockReturnValue({
    proxyAddress: "addr_test_proxy",
    authTokenId: "policy",
    paramUtxo: { txHash: "aa", outputIndex: 0 },
  });
  (completeMock as any).mockResolvedValue("tx-cbor");
  getTxBuilderMock.mockReturnValue({ complete: completeMock, meshTxBuilderBody: {} });
  (createPendingMultisigTransactionMock as any).mockResolvedValue({ id: "tx-1" });
});

describe("proxySetup bot API", () => {
  it("rejects invalid initialProxyLovelace before resolving UTxOs", async () => {
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        walletId: "wallet-1",
        address: makeBotJwtPayload().address,
        utxoRefs: [{ txHash: "aa", outputIndex: 0 }],
        collateralRef: { txHash: "bb", outputIndex: 1 },
        initialProxyLovelace: "0",
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(resolveUtxoRefsFromChainMock).not.toHaveBeenCalled();
  });

  it("passes valid initialProxyLovelace to the setup builder", async () => {
    const req = {
      method: "POST",
      headers: makeBearerAuth(),
      body: {
        walletId: "wallet-1",
        address: makeBotJwtPayload().address,
        utxoRefs: [{ txHash: "aa", outputIndex: 0 }],
        collateralRef: { txHash: "bb", outputIndex: 1 },
        initialProxyLovelace: "5000000",
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(resolveCollateralRefFromChainMock).toHaveBeenCalledWith(
      expect.objectContaining({
        collateralRef: { txHash: "bb", outputIndex: 1 },
        expectedAddress: makeBotJwtPayload().address,
      }),
    );
    expect(buildProxySetupTxMock).toHaveBeenCalledWith(
      expect.objectContaining({ initialProxyLovelace: "5000000" }),
    );
    expect(createPendingMultisigTransactionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        proposerAddress: makeBotJwtPayload().address,
        initialSignedAddresses: [],
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
