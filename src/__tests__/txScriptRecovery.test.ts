import { describe, expect, it } from "@jest/globals";
import type { MultisigSubmissionWallet } from "@/types/txSign";
import { shouldSubmitMultisigTx } from "@/utils/txScriptRecovery";

const signersAddresses = ["addr_test_1", "addr_test_2", "addr_test_3"];

function wallet(overrides: Partial<MultisigSubmissionWallet>): MultisigSubmissionWallet {
  return {
    type: "all",
    numRequiredSigners: null,
    signersAddresses,
    ...overrides,
  };
}

describe("shouldSubmitMultisigTx", () => {
  it("honors an explicit threshold stored on all wallets", () => {
    const appWallet = wallet({ type: "all", numRequiredSigners: 2 });

    expect(shouldSubmitMultisigTx(appWallet, 1)).toBe(false);
    expect(shouldSubmitMultisigTx(appWallet, 2)).toBe(true);
  });

  it("keeps flat all wallets as all-of-N when no threshold is stored", () => {
    const appWallet = wallet({ type: "all", numRequiredSigners: null });

    expect(shouldSubmitMultisigTx(appWallet, 2)).toBe(false);
    expect(shouldSubmitMultisigTx(appWallet, 3)).toBe(true);
  });

  it("keeps existing any and atLeast behavior", () => {
    expect(shouldSubmitMultisigTx(wallet({ type: "any", numRequiredSigners: null }), 1)).toBe(true);
    expect(shouldSubmitMultisigTx(wallet({ type: "atLeast", numRequiredSigners: 2 }), 1)).toBe(false);
    expect(shouldSubmitMultisigTx(wallet({ type: "atLeast", numRequiredSigners: 2 }), 2)).toBe(true);
  });
});
