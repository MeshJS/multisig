import { deriveDrepVoteContext } from "@/lib/governance/drep-context";
import { MultisigWallet, type MultisigKey } from "@/utils/multisigSDK";

const PAYMENT_HASH = "a".repeat(56);
const DREP_HASH = "b".repeat(56);

function walletWith(keys: MultisigKey[]): MultisigWallet {
  return new MultisigWallet("Test", keys, "", 1, 0);
}

const APP_WALLET = { dRepId: "drep1fallback", scriptCbor: "82fallback" };

describe("deriveDrepVoteContext", () => {
  test("uses the wallet's role-3 DRep script when present", () => {
    const wallet = walletWith([
      { keyHash: PAYMENT_HASH, role: 0, name: "P" },
      { keyHash: DREP_HASH, role: 3, name: "D" },
    ]);
    const ctx = deriveDrepVoteContext(wallet, APP_WALLET);
    expect(ctx).toBeDefined();
    expect(ctx!.dRepId.startsWith("drep")).toBe(true);
    expect(ctx!.drepScriptCbor).toBe(wallet.getDRepScript());
    // Role-3 derivation must not silently return the app-wallet fallback.
    expect(ctx!.dRepId).not.toBe(APP_WALLET.dRepId);
  });

  test("falls back to the payment script when there are no DRep keys", () => {
    const wallet = walletWith([{ keyHash: PAYMENT_HASH, role: 0, name: "P" }]);
    const ctx = deriveDrepVoteContext(wallet, undefined);
    expect(ctx).toBeDefined();
    expect(ctx!.drepScriptCbor).toBe(wallet.getDRepScript());
  });

  test("legacy wallets without a MultisigWallet use the app wallet", () => {
    expect(deriveDrepVoteContext(undefined, APP_WALLET)).toEqual({
      dRepId: "drep1fallback",
      drepScriptCbor: "82fallback",
    });
  });

  test("keyless wallet with app fallback returns the fallback, without → undefined", () => {
    const keyless = walletWith([]);
    expect(deriveDrepVoteContext(keyless, APP_WALLET)).toEqual({
      dRepId: "drep1fallback",
      drepScriptCbor: "82fallback",
    });
    expect(deriveDrepVoteContext(keyless, undefined)).toBeUndefined();
    expect(deriveDrepVoteContext(undefined, undefined)).toBeUndefined();
    expect(
      deriveDrepVoteContext(undefined, { dRepId: null, scriptCbor: "x" }),
    ).toBeUndefined();
  });
});
