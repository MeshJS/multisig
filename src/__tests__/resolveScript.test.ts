import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMockResponse } from "./apiTestUtils";

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => boolean>();
const providerGetMock = jest.fn<(path: string) => Promise<unknown>>();
const deserializeAddressMock = jest.fn<(address: string) => unknown>();

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: addCorsHeadersMock,
  cors: corsMock,
}));

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: applyRateLimitMock,
}));

jest.mock("@/utils/get-provider", () => ({
  __esModule: true,
  getProvider: () => ({
    get: providerGetMock,
  }),
}));

jest.mock("@meshsdk/core", () => ({
  __esModule: true,
  deserializeAddress: (address: string) => deserializeAddressMock(address),
}));

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import("../pages/api/v1/resolveScript"));
});

beforeEach(() => {
  jest.clearAllMocks();
  applyRateLimitMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
});

const scriptHash = "1".repeat(56);
const scriptAddress = "addr_test1scriptaddress";
const keyAddress = "addr_test1keyaddress";
const sigA = "b".repeat(56);
const sigB = "c".repeat(56);
const scriptJson = {
  type: "atLeast",
  required: 2,
  scripts: [
    { type: "sig", keyHash: sigA.toUpperCase() },
    { type: "sig", keyHash: sigB },
  ],
};
const notFound = {
  response: { data: { error: "Not Found", status_code: 404 } },
};

function makeRequest(query: Record<string, string>): NextApiRequest {
  return {
    method: "GET",
    headers: {},
    query,
  } as unknown as NextApiRequest;
}

describe("resolveScript API", () => {
  it("rejects a request with neither selector", async () => {
    const res = createMockResponse();
    await handler(makeRequest({ network: "0" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(providerGetMock).not.toHaveBeenCalled();
  });

  it("rejects a request with both selectors", async () => {
    const res = createMockResponse();
    await handler(
      makeRequest({ scriptHash, address: scriptAddress, network: "0" }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects an invalid scriptHash", async () => {
    const res = createMockResponse();
    await handler(makeRequest({ scriptHash: "nope", network: "0" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects an invalid network", async () => {
    const res = createMockResponse();
    await handler(makeRequest({ scriptHash, network: "7" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects an address without a script payment credential", async () => {
    deserializeAddressMock.mockReturnValue({
      pubKeyHash: "d".repeat(56),
      scriptHash: "",
      stakeCredentialHash: "",
      stakeScriptCredentialHash: "",
    });
    const res = createMockResponse();
    await handler(makeRequest({ address: keyAddress, network: "0" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Address is not a multisig (script) address",
    });
  });

  it("rejects an address that does not deserialize", async () => {
    deserializeAddressMock.mockImplementation(() => {
      throw new Error("bad bech32");
    });
    const res = createMockResponse();
    await handler(makeRequest({ address: "garbage", network: "0" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("resolves sig hashes for a script hash", async () => {
    providerGetMock.mockImplementation(async (path: unknown) => {
      if (path === `/scripts/${scriptHash}/json`) return { json: scriptJson };
      throw new Error(`Unexpected provider path: ${String(path)}`);
    });

    const res = createMockResponse();
    await handler(makeRequest({ scriptHash: scriptHash.toUpperCase(), network: "0" }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      scriptHash,
      stakeCredentialHash: null,
      scriptJson,
      sigHashes: [sigA, sigB],
    });
    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "public, max-age=300, stale-while-revalidate=600",
    );
  });

  it("resolves via a multisig address and carries its stake credential", async () => {
    deserializeAddressMock.mockReturnValue({
      pubKeyHash: "",
      scriptHash,
      stakeCredentialHash: "",
      stakeScriptCredentialHash: "2".repeat(56),
    });
    providerGetMock.mockResolvedValue({ json: scriptJson });

    const res = createMockResponse();
    await handler(makeRequest({ address: scriptAddress, network: "1" }), res);

    expect(deserializeAddressMock).toHaveBeenCalledWith(scriptAddress);
    expect(providerGetMock).toHaveBeenCalledWith(`/scripts/${scriptHash}/json`);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      scriptHash,
      stakeCredentialHash: "2".repeat(56),
      scriptJson,
      sigHashes: [sigA, sigB],
    });
  });

  it("returns an empty resolution when the provider has no such script", async () => {
    providerGetMock.mockRejectedValue(notFound);

    const res = createMockResponse();
    await handler(makeRequest({ scriptHash, network: "0" }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      scriptHash,
      stakeCredentialHash: null,
      scriptJson: null,
      sigHashes: [],
    });
    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=120",
    );
  });

  it("returns an empty resolution for a Plutus script (no timelock json)", async () => {
    providerGetMock.mockResolvedValue({ json: null });

    const res = createMockResponse();
    await handler(makeRequest({ scriptHash, network: "0" }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      scriptHash,
      stakeCredentialHash: null,
      scriptJson: null,
      sigHashes: [],
    });
  });

  it("surfaces unsupported script json with no signers", async () => {
    const weird = { type: "mystery" };
    providerGetMock.mockResolvedValue({ json: weird });

    const res = createMockResponse();
    await handler(makeRequest({ scriptHash, network: "0" }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      scriptHash,
      stakeCredentialHash: null,
      scriptJson: weird,
      sigHashes: [],
    });
  });

  it("returns 500 on unexpected provider failures", async () => {
    providerGetMock.mockRejectedValue(new Error("boom"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const res = createMockResponse();
    await handler(makeRequest({ scriptHash, network: "0" }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    errorSpy.mockRestore();
  });

  it("stops when the rate limiter rejects the request", async () => {
    applyRateLimitMock.mockReturnValue(false);
    const res = createMockResponse();
    await handler(makeRequest({ scriptHash, network: "0" }), res);
    expect(corsMock).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects non-GET methods", async () => {
    const res = createMockResponse();
    await handler(
      { ...makeRequest({ scriptHash }), method: "POST" } as NextApiRequest,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
