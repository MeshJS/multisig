import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMockResponse } from "./apiTestUtils";

const addCorsHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();
const applyRateLimitMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => boolean>();
const providerGetMock: jest.Mock = jest.fn();
const deserializeAddressMock: jest.Mock = jest.fn();

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
  ({ default: handler } = await import("../pages/api/v1/resolveRegistrationScript"));
});

beforeEach(() => {
  jest.clearAllMocks();
  applyRateLimitMock.mockReturnValue(true);
  corsMock.mockResolvedValue(undefined);
});

const txHash = "a".repeat(64);
const scriptHash = "1".repeat(56);
const scriptAddress = "addr_test1scriptaddress";
const keyAddress = "addr_test1keyaddress";

function makeRequest(query: Record<string, string>): NextApiRequest {
  return {
    method: "GET",
    headers: {},
    query,
  } as unknown as NextApiRequest;
}

describe("resolveRegistrationScript API", () => {
  it("rejects an invalid txHash", async () => {
    const res = createMockResponse();
    await handler(makeRequest({ txHash: "not-a-hash", network: "0" }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("resolves script candidates from the transaction's addresses", async () => {
    (providerGetMock as any).mockImplementation(async (path: string) => {
      if (path === `/txs/${txHash}/utxos`) {
        return {
          inputs: [{ address: scriptAddress }],
          outputs: [{ address: scriptAddress }, { address: keyAddress }],
        };
      }
      if (path === `/scripts/${scriptHash}/json`) {
        return {
          json: {
            type: "atLeast",
            required: 2,
            scripts: [
              { type: "sig", keyHash: "b".repeat(56) },
              { type: "sig", keyHash: "c".repeat(56) },
            ],
          },
        };
      }
      throw new Error(`Unexpected provider path: ${path}`);
    });
    deserializeAddressMock.mockImplementation((address) => {
      if (address === scriptAddress) {
        return {
          pubKeyHash: "",
          scriptHash,
          stakeCredentialHash: "",
          stakeScriptCredentialHash: "2".repeat(56),
        };
      }
      return {
        pubKeyHash: "d".repeat(56),
        scriptHash: "",
        stakeCredentialHash: "",
        stakeScriptCredentialHash: "",
      };
    });

    const res = createMockResponse();
    await handler(makeRequest({ txHash, network: "0" }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      txHash,
      candidates: [
        {
          address: scriptAddress,
          scriptHash,
          stakeCredentialHash: "2".repeat(56),
          scriptJson: {
            type: "atLeast",
            required: 2,
            scripts: [
              { type: "sig", keyHash: "b".repeat(56) },
              { type: "sig", keyHash: "c".repeat(56) },
            ],
          },
        },
      ],
    });
    // The script address appears in both inputs and outputs but must be
    // resolved only once.
    expect(providerGetMock).toHaveBeenCalledTimes(2);
  });

  it("skips scripts the provider cannot resolve", async () => {
    (providerGetMock as any).mockImplementation(async (path: string) => {
      if (path === `/txs/${txHash}/utxos`) {
        return { inputs: [], outputs: [{ address: scriptAddress }] };
      }
      throw {
        response: { data: { error: "Not Found", status_code: 404 } },
      };
    });
    deserializeAddressMock.mockReturnValue({
      pubKeyHash: "",
      scriptHash,
      stakeCredentialHash: "",
      stakeScriptCredentialHash: "",
    });

    const res = createMockResponse();
    await handler(makeRequest({ txHash, network: "1" }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ txHash, candidates: [] });
  });

  it("returns empty candidates when the transaction is unknown", async () => {
    (providerGetMock as any).mockRejectedValue({
      response: { data: { error: "Not Found", status_code: 404 } },
    });

    const res = createMockResponse();
    await handler(makeRequest({ txHash, network: "0" }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ txHash, candidates: [] });
  });
});
