import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * `recipientsToBaseUnits`: the one conversion between the recipients a
 * caller writes (display units, `transaction_preview`'s output shape) and
 * the rows the board stores. It rides the tx-review normalizer, so the
 * rules are the same as for a drafted payment: registry decimals, no
 * guessing for a token without them.
 */

const resolveAssetMetadataMock: jest.Mock = jest.fn();
const getProviderMock: jest.Mock = jest.fn();

class TxReviewErrorMock extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

jest.mock("@/lib/tx-review/context", () => ({
  __esModule: true,
  TxReviewError: TxReviewErrorMock,
}));

jest.mock("@/lib/tx-review/metadata", () => ({
  __esModule: true,
  resolveAssetMetadata: resolveAssetMetadataMock,
}));

jest.mock("@/utils/get-provider", () => ({
  __esModule: true,
  getProvider: getProviderMock,
}));

const POLICY = "a".repeat(56);
const HOSKY = `${POLICY}${Buffer.from("HOSKY").toString("hex")}`;
const decimals = new Map<string, number>([[HOSKY, 0]]);

let recipientsToBaseUnits: typeof import("@/lib/task-payout/recipients").recipientsToBaseUnits;

beforeAll(async () => {
  ({ recipientsToBaseUnits } = await import("@/lib/task-payout/recipients"));
});

beforeEach(() => {
  jest.clearAllMocks();
  getProviderMock.mockReturnValue({ provider: "stub" });
  (resolveAssetMetadataMock as any).mockResolvedValue({
    metadata: {},
    decimalsFor: (unit: string) => decimals.get(unit),
  });
});

describe("recipientsToBaseUnits", () => {
  it("returns no rows for no recipients without touching the registry", async () => {
    await expect(recipientsToBaseUnits(0, "wallet-1", [])).resolves.toEqual([]);
    expect(resolveAssetMetadataMock).not.toHaveBeenCalled();
  });

  it("converts ADA and tokens to base units, one row per (address, unit)", async () => {
    const rows = await recipientsToBaseUnits(0, "wallet-1", [
      { address: "addr_test1qpx", ada: "5", assets: [{ unit: HOSKY, quantity: "1000" }] },
      { address: "addr_test1qpy", ada: "1.5" },
    ]);
    expect(getProviderMock).toHaveBeenCalledWith(0);
    expect(resolveAssetMetadataMock).toHaveBeenCalledWith({ provider: "stub" }, [HOSKY], 0);
    expect(rows).toEqual([
      { address: "addr_test1qpx", unit: "lovelace", quantity: "5000000" },
      { address: "addr_test1qpx", unit: HOSKY, quantity: "1000" },
      { address: "addr_test1qpy", unit: "lovelace", quantity: "1500000" },
    ]);
  });

  it("refuses a fractional amount for a token without registered decimals", async () => {
    (resolveAssetMetadataMock as any).mockResolvedValue({ metadata: {}, decimalsFor: () => undefined });
    await expect(
      recipientsToBaseUnits(0, "wallet-1", [
        { address: "addr_test1qpx", assets: [{ unit: HOSKY, quantity: "2.5" }] },
      ]),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_SPEC", details: { issues: expect.any(Array) } });
  });
});
