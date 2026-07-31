import { describe, expect, it } from "@jest/globals";

import {
  formatAssetQuantity,
  type AssetMetadataMap,
} from "@/components/common/token-flow/format";

const LONG_UNIT = "aaaaaaaabbbbbbbbccccccccdd"; // > 20 chars → truncated

const metadata: AssetMetadataMap = {
  [LONG_UNIT]: {
    assetName: "Puku Token",
    decimals: 2,
    image: "",
    ticker: "PUKU",
    policyId: "aaaaaaaa",
  },
};

describe("formatAssetQuantity", () => {
  it("renders lovelace as ADA with six decimals and the ₳ sign", () => {
    expect(formatAssetQuantity({ unit: "lovelace", quantity: "1500000" })).toBe("1.5 ₳");
    expect(formatAssetQuantity({ unit: "lovelace", quantity: "1234567" })).toBe(
      "1.234567 ₳",
    );
  });

  it("rounds large amounts to two decimals with thousands separators", () => {
    expect(formatAssetQuantity({ unit: "lovelace", quantity: "1234567890" })).toBe(
      "1,234.57 ₳",
    );
  });

  it("keeps negative deltas signed", () => {
    expect(formatAssetQuantity({ unit: "lovelace", quantity: "-2500000" })).toBe(
      "-2.5 ₳",
    );
  });

  it("uses the registered ticker and decimals for known assets", () => {
    expect(
      formatAssetQuantity({ unit: LONG_UNIT, quantity: "12345" }, metadata),
    ).toBe("123.45 $PUKU");
  });

  it("falls back to the truncated unit string without metadata", () => {
    expect(formatAssetQuantity({ unit: LONG_UNIT, quantity: "5" })).toBe(
      "5 aaaaaaaa...ccccdd",
    );
  });

  it("keeps short units untruncated at zero decimals", () => {
    expect(formatAssetQuantity({ unit: "shortunit", quantity: "7" })).toBe(
      "7 shortunit",
    );
  });
});
