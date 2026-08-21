import { deriveStakeCertContext } from "@/lib/staking/stake-context";
import { MultisigWallet, type MultisigKey } from "@/utils/multisigSDK";

const PAYMENT_HASH = "a".repeat(56);
const STAKE_HASH = "b".repeat(56);

function walletWith(keys: MultisigKey[]): MultisigWallet {
  return new MultisigWallet("Test", keys, "", 1, 0);
}

describe("deriveStakeCertContext", () => {
  test("derives reward address and staking script from role-2 keys", () => {
    const wallet = walletWith([
      { keyHash: PAYMENT_HASH, role: 0, name: "P" },
      { keyHash: STAKE_HASH, role: 2, name: "S" },
    ]);
    const ctx = deriveStakeCertContext(wallet, undefined);
    expect(ctx).toBeDefined();
    expect(ctx!.rewardAddress).toBe(wallet.getStakeAddress());
    expect(ctx!.rewardAddress.startsWith("stake")).toBe(true);
    expect(ctx!.stakeScriptCbor).toBe(wallet.getStakingScript());
  });

  test("prefers the app wallet's stored staking script (imported wallets)", () => {
    const wallet = walletWith([
      { keyHash: PAYMENT_HASH, role: 0, name: "P" },
      { keyHash: STAKE_HASH, role: 2, name: "S" },
    ]);
    const ctx = deriveStakeCertContext(wallet, { stakeScriptCbor: "82stored" });
    expect(ctx!.stakeScriptCbor).toBe("82stored");
    expect(ctx!.rewardAddress).toBe(wallet.getStakeAddress());
  });

  test("returns undefined without a derivable staking identity", () => {
    // No multisig wallet at all — the stored script alone is unusable
    // because there is no reward address to certify against.
    expect(
      deriveStakeCertContext(undefined, { stakeScriptCbor: "82stored" }),
    ).toBeUndefined();
    expect(deriveStakeCertContext(undefined, undefined)).toBeUndefined();
  });
});
