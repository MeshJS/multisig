import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const insertedLanguages: string[] = [];
const costModelValues: number[][] = [];
const setScriptDataHashMock = jest.fn();
const hashScriptDataMock = jest.fn(() => ({ hash: "fresh-script-data-hash" }));

class MockCostModel {
  values: number[] = [];

  static new() {
    const model = new MockCostModel();
    costModelValues.push(model.values);
    return model;
  }

  set(index: number, cost: { value: number }) {
    this.values[index] = cost.value;
    return cost;
  }
}

class MockCostmdls {
  static new() {
    return new MockCostmdls();
  }

  insert(language: { label: string }, _costModel: MockCostModel) {
    insertedLanguages.push(language.label);
    return undefined;
  }
}

class MockLanguage {
  static new_plutus_v1() {
    return { label: "V1" };
  }

  static new_plutus_v2() {
    return { label: "V2" };
  }

  static new_plutus_v3() {
    return { label: "V3" };
  }
}

class MockInt {
  static new_i32(value: number) {
    return { value };
  }
}

class MockTransaction {
  private static redeemerCount = 0;
  private static updatedHex = "updated-tx-hex";

  static configure(args: { redeemerCount: number; updatedHex?: string }) {
    MockTransaction.redeemerCount = args.redeemerCount;
    MockTransaction.updatedHex = args.updatedHex ?? "updated-tx-hex";
  }

  static from_hex(hex: string) {
    return {
      witness_set: () => ({
        redeemers: () =>
          MockTransaction.redeemerCount > 0
            ? { len: () => MockTransaction.redeemerCount }
            : undefined,
        plutus_data: () => ({ datum: true }),
      }),
      body: () => ({ set_script_data_hash: setScriptDataHashMock }),
      auxiliary_data: () => ({ metadata: true }),
      is_valid: () => true,
      to_hex: () => hex,
    };
  }

  static new() {
    return {
      set_is_valid: jest.fn(),
      to_hex: () => MockTransaction.updatedHex,
    };
  }
}

jest.mock(
  "@meshsdk/core-csl",
  () => ({
    __esModule: true,
    csl: {
      CostModel: MockCostModel,
      Costmdls: MockCostmdls,
      Int: MockInt,
      Language: MockLanguage,
      Transaction: MockTransaction,
      hash_script_data: hashScriptDataMock,
    },
  }),
  { virtual: true },
);

jest.mock(
  "@/env",
  () => ({
    __esModule: true,
    env: {
      NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD: "preprod-key",
      NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET: "mainnet-key",
    },
  }),
  { virtual: true },
);

describe("refreshScriptDataHash", () => {
  beforeEach(() => {
    insertedLanguages.length = 0;
    costModelValues.length = 0;
    setScriptDataHashMock.mockClear();
    hashScriptDataMock.mockClear();
    MockTransaction.configure({ redeemerCount: 0 });
  });

  it("leaves transactions without redeemers unchanged", async () => {
    const { refreshScriptDataHash } = await import("@/lib/completeTxWithFreshCostModels");

    expect(refreshScriptDataHash("unsigned-tx-hex", {}, {})).toBe("unsigned-tx-hex");
    expect(hashScriptDataMock).not.toHaveBeenCalled();
    expect(setScriptDataHashMock).not.toHaveBeenCalled();
  });

  it("recomputes script data hash with Plutus V3 cost_models_raw arrays", async () => {
    MockTransaction.configure({ redeemerCount: 1, updatedHex: "fresh-tx-hex" });
    const { refreshScriptDataHash } = await import("@/lib/completeTxWithFreshCostModels");

    const refreshed = refreshScriptDataHash(
      "unsigned-tx-hex",
      {
        PlutusV3: [10, 20],
      },
      {
        mints: [
          {
            type: "Plutus",
            scriptSource: { script: { version: "V3" } },
          },
        ],
      },
    );

    expect(refreshed).toBe("fresh-tx-hex");
    expect(insertedLanguages).toEqual(["V3"]);
    expect(costModelValues).toEqual([[10, 20]]);
    expect(hashScriptDataMock).toHaveBeenCalled();
    expect(setScriptDataHashMock).toHaveBeenCalledWith({ hash: "fresh-script-data-hash" });
  });

  it("orders indexed cost model objects by numeric key", async () => {
    MockTransaction.configure({ redeemerCount: 1, updatedHex: "fresh-tx-hex" });
    const { refreshScriptDataHash } = await import("@/lib/completeTxWithFreshCostModels");

    refreshScriptDataHash(
      "unsigned-tx-hex",
      {
        PlutusV3: {
          "2": 30,
          "0": 10,
          "1": 20,
        },
      },
      {
        mints: [
          {
            type: "Plutus",
            scriptSource: { script: { version: "V3" } },
          },
        ],
      },
    );

    expect(costModelValues).toEqual([[10, 20, 30]]);
  });

  it("rejects named cost_models objects that are not in ledger order", async () => {
    MockTransaction.configure({ redeemerCount: 1 });
    const { refreshScriptDataHash } = await import("@/lib/completeTxWithFreshCostModels");

    expect(() =>
      refreshScriptDataHash(
        "unsigned-tx-hex",
        {
          PlutusV3: {
            "addInteger-cpu-arguments-intercept": 10,
            "addInteger-cpu-arguments-slope": 20,
          },
        },
        {
          mints: [
            {
              type: "Plutus",
              scriptSource: { script: { version: "V3" } },
            },
          ],
        },
      ),
    ).toThrow(/cost_models_raw/);
  });
});
