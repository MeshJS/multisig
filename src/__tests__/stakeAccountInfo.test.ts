import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMockResponse } from "./apiTestUtils";

const providerGetMock = jest.fn<(path: string) => Promise<unknown>>();
const getProviderMock = jest.fn((_network: number) => ({ get: providerGetMock }));

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: jest.fn(),
  cors: jest.fn(async () => undefined),
}));

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: () => true,
  applyBotRateLimit: () => true,
}));

jest.mock("@/lib/verifyJwt", () => ({
  __esModule: true,
  verifyJwt: (token: string) => (token === "good" ? { address: "addr_test1x" } : null),
  isBotJwt: () => false,
}));

jest.mock("@/utils/get-provider", () => ({
  __esModule: true,
  getProvider: (network: number) => getProviderMock(network),
}));

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/stakeAccountInfo"));
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

// Well-formed bech32 reward addresses (header byte + 28-byte credential).
const MAINNET = "stake1uyrswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc4vqlc2";
const TESTNET = "stake_test1uqrswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpcjx2auh";
// Script-credential reward address (header 0xf1), as a multisig wallet has.
const MAINNET_SCRIPT = "stake17yrswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpcuyul02";

/** What Mesh's BlockfrostProvider.get rejects with (parseHttpError). */
const meshRejection = (status: number) =>
  JSON.stringify({ data: { status_code: status }, headers: {}, status });

async function call(stakeAddress: unknown, token = "good") {
  const req = {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
    query: stakeAddress === undefined ? {} : { stakeAddress },
  } as unknown as NextApiRequest;
  const res = createMockResponse();
  await handler(req, res);
  return res;
}

describe("GET /api/v1/stakeAccountInfo", () => {
  it("requires a valid bearer token", async () => {
    const res = await call(TESTNET, "bad");
    expect(res.statusCode).toBe(401);
    expect(providerGetMock).not.toHaveBeenCalled();
  });

  it("reads a registered account from the network its address names", async () => {
    providerGetMock.mockResolvedValueOnce({ active: true, pool_id: "pool1abc" });
    const res = await call(` ${TESTNET} `);
    expect(getProviderMock).toHaveBeenCalledWith(0);
    expect(providerGetMock).toHaveBeenCalledWith(`/accounts/${TESTNET}`);
    expect(res.statusCode).toBe(200);
    expect(res.json).toHaveBeenCalledWith({ active: true, poolId: "pool1abc" });

    for (const address of [MAINNET, MAINNET_SCRIPT]) {
      providerGetMock.mockResolvedValueOnce({ active: false, pool_id: null });
      const mainnet = await call(address);
      expect(mainnet.statusCode).toBe(200);
      expect(getProviderMock).toHaveBeenLastCalledWith(1);
      expect(providerGetMock).toHaveBeenLastCalledWith(`/accounts/${address}`);
    }
  });

  it("answers 200 inactive for a never-registered account (Mesh's string 404)", async () => {
    // A fresh multisig wallet's stake credential has never appeared on chain;
    // that is the normal "not registered yet" answer, not a server error.
    providerGetMock.mockRejectedValueOnce(meshRejection(404));
    const res = await call(TESTNET);
    expect(res.statusCode).toBe(200);
    expect(res.json).toHaveBeenCalledWith({ active: false, poolId: null });
  });

  it("still answers 500 when the lookup itself fails", async () => {
    providerGetMock.mockRejectedValueOnce(meshRejection(500));
    const res = await call(TESTNET);
    expect(res.statusCode).toBe(500);
  });

  it.each([
    ["missing", undefined],
    ["empty", "  "],
    ["repeated", [TESTNET, TESTNET]],
    ["a path escape", `${TESTNET}/../../addresses/addr_test1x`],
    ["another endpoint", `${TESTNET}/history`],
    ["a query string", `${TESTNET}?page=2`],
    ["a payment address", "addr_test1qrswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpcjx2auh"],
    ["a truncated address", TESTNET.slice(0, -1)],
    ["characters outside bech32", TESTNET.replace(/q/g, "b")],
  ])("rejects %s with 400 before calling Blockfrost", async (_label, value) => {
    const res = await call(value);
    expect(res.statusCode).toBe(400);
    expect(providerGetMock).not.toHaveBeenCalled();
  });
});
