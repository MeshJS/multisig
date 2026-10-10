import { describe, expect, it } from "@jest/globals";

import {
  describeAsset,
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

describe("describeAsset", () => {
  const NFT_UNIT = "ffffffffeeeeeeeeddddddddcc";
  const richMetadata: AssetMetadataMap = {
    ...metadata,
    [LONG_UNIT]: { ...metadata[LONG_UNIT]!, image: "ipfs://QmPukuLogo" },
    [NFT_UNIT]: {
      assetName: "SpaceBud #42",
      decimals: 0,
      image: "ipfs://QmSpaceBud",
      ticker: "",
      policyId: "ffffffff",
    },
  };

  it("renders lovelace as plain ADA text with no image", () => {
    expect(describeAsset({ unit: "lovelace", quantity: "1500000" })).toEqual({
      text: "1.5 ₳",
      isNft: false,
    });
  });

  it("passes the metadata image through for known fungible tokens", () => {
    expect(
      describeAsset({ unit: LONG_UNIT, quantity: "12345" }, richMetadata),
    ).toEqual({ text: "123.45 $PUKU", image: "ipfs://QmPukuLogo", isNft: false });
  });

  it("renders a single indivisible known asset NFT-style: name, no quantity", () => {
    expect(
      describeAsset({ unit: NFT_UNIT, quantity: "1" }, richMetadata),
    ).toEqual({ text: "SpaceBud #42", image: "ipfs://QmSpaceBud", isNft: true });
  });

  it("truncates long NFT names", () => {
    const longName: AssetMetadataMap = {
      [NFT_UNIT]: {
        ...richMetadata[NFT_UNIT]!,
        assetName: "An Exceedingly Long Collectible Name",
      },
    };
    const desc = describeAsset({ unit: NFT_UNIT, quantity: "1" }, longName);
    expect(desc.isNft).toBe(true);
    expect(desc.text).toBe("An Excee...e Name");
  });

  it("does not treat multiple units of a zero-decimal asset as an NFT", () => {
    const desc = describeAsset({ unit: NFT_UNIT, quantity: "2" }, richMetadata);
    expect(desc.isNft).toBe(false);
    expect(desc.text).toBe("2 SpaceBud #42");
  });

  it("falls back to the asset name with decimals when there is no ticker", () => {
    const named: AssetMetadataMap = {
      [LONG_UNIT]: { ...metadata[LONG_UNIT]!, ticker: "" },
    };
    expect(describeAsset({ unit: LONG_UNIT, quantity: "12345" }, named)).toEqual(
      { text: "123.45 Puku Token", isNft: false },
    );
  });

  it("keeps the truncated-unit fallback for unknown assets", () => {
    expect(describeAsset({ unit: LONG_UNIT, quantity: "5" })).toEqual({
      text: "5 aaaaaaaa...ccccdd",
      isNft: false,
    });
  });
});
