import { describe, expect, it } from "@jest/globals";
import { getWalletType } from "@/utils/common";
import { DbWalletWithLegacy } from "@/types/wallet";

function makeWallet(overrides: Partial<DbWalletWithLegacy> = {}): DbWalletWithLegacy {
  return {
    signersStakeKeys: [],
    signersDRepKeys: [],
    rawImportBodies: null,
    ...overrides,
  } as unknown as DbWalletWithLegacy;
}

describe("getWalletType", () => {
  it("returns summon when raw import multisig body is present", () => {
    const wallet = makeWallet({
      rawImportBodies: {
        multisig: {
          address: "addr_test1...",
        },
      },
      signersStakeKeys: ["stake_test1..."],
      signersDRepKeys: ["drep_key"],
    });

    expect(getWalletType(wallet)).toBe("summon");
  });

  it("returns legacy when stake/drep arrays only contain empty values", () => {
    const wallet = makeWallet({
      signersStakeKeys: ["", "   "],
      signersDRepKeys: ["", "  "],
    });

    expect(getWalletType(wallet)).toBe("legacy");
  });

  it("returns sdk when there is at least one non-empty trimmed stake key", () => {
    const wallet = makeWallet({
      signersStakeKeys: ["   ", "stake_test1uq..."],
      signersDRepKeys: ["", " "],
    });

    expect(getWalletType(wallet)).toBe("sdk");
  });

  it("returns sdk when there is at least one non-empty trimmed drep key", () => {
    const wallet = makeWallet({
      signersStakeKeys: ["", " "],
      signersDRepKeys: ["   ", "drep_key_hash"],
    });

    expect(getWalletType(wallet)).toBe("sdk");
  });
});
