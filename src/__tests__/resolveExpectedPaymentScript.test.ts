import { serializeNativeScript, type NativeScript } from "@meshsdk/core";

import type { ScriptRecoveryWallet } from "@/types/txSign";
import { resolveExpectedPaymentScriptCbor } from "@/utils/txSignUtils";
import { mockKeyHashes } from "./testUtils";

/**
 * Regression guard for the build-time script resolution added to the
 * new-transaction form and the canvas builder:
 *
 *   resolveExpectedPaymentScriptCbor(appWallet) ?? appWallet.scriptCbor
 *
 * must embed byte-identical script CBOR to the previous behavior (raw
 * appWallet.scriptCbor) for every wallet shape `buildWallet` produces —
 * app-created (legacy/SDK, no rawImportBodies) and Summon imports (where
 * buildWallet already stores the address-matching script in scriptCbor via
 * resolveSummonScriptCbors, whose selection logic this function mirrors).
 */

function script(keyHash: string): NativeScript {
  return { type: "all", scripts: [{ type: "sig", keyHash }] };
}

const a = serializeNativeScript(script(mockKeyHashes.payment1), undefined, 0, true);
const b = serializeNativeScript(script(mockKeyHashes.payment2), undefined, 0, true);
const c = serializeNativeScript(script(mockKeyHashes.stake1), undefined, 0, true);

function wallet(overrides: Partial<ScriptRecoveryWallet>): ScriptRecoveryWallet {
  return {
    type: "all",
    numRequiredSigners: 1,
    signersAddresses: [],
    scriptCbor: a.scriptCbor,
    address: a.address,
    ...overrides,
  } as ScriptRecoveryWallet;
}

function embeddedScript(appWallet: ScriptRecoveryWallet): string | undefined {
  return resolveExpectedPaymentScriptCbor(appWallet) ?? appWallet.scriptCbor;
}

describe("build-time script resolution preserves embedded CBOR", () => {
  test("app-created wallet (no rawImportBodies), script matches address", () => {
    const appWallet = wallet({});
    expect(embeddedScript(appWallet)).toBe(appWallet.scriptCbor);
  });

  test("app-created wallet whose scriptCbor does NOT match its address still embeds scriptCbor (no-op even for broken wallets)", () => {
    const appWallet = wallet({ address: b.address });
    expect(embeddedScript(appWallet)).toBe(appWallet.scriptCbor);
  });

  test("Summon wallet: payment_script matches address — same pick buildWallet already stored", () => {
    const appWallet = wallet({
      scriptCbor: a.scriptCbor, // buildWallet's resolveSummonScriptCbors pick
      address: a.address,
      rawImportBodies: {
        multisig: { payment_script: a.scriptCbor, stake_script: b.scriptCbor },
      },
    });
    expect(embeddedScript(appWallet)).toBe(appWallet.scriptCbor);
  });

  test("Summon wallet with swapped scripts (address credential is the stake script) — same pick buildWallet already stored", () => {
    const appWallet = wallet({
      scriptCbor: b.scriptCbor, // buildWallet swapped: stake_script matched
      address: b.address,
      rawImportBodies: {
        multisig: { payment_script: a.scriptCbor, stake_script: b.scriptCbor },
      },
    });
    expect(embeddedScript(appWallet)).toBe(appWallet.scriptCbor);
  });

  test("Summon wallet where neither raw script matches the address falls back to scriptCbor", () => {
    const appWallet = wallet({
      scriptCbor: a.scriptCbor,
      address: c.address,
      rawImportBodies: {
        multisig: { payment_script: a.scriptCbor, stake_script: b.scriptCbor },
      },
    });
    expect(embeddedScript(appWallet)).toBe(appWallet.scriptCbor);
  });

  test("unparseable address falls back to scriptCbor", () => {
    const appWallet = wallet({
      address: "not-an-address",
      rawImportBodies: {
        multisig: { payment_script: a.scriptCbor, stake_script: b.scriptCbor },
      },
    });
    expect(embeddedScript(appWallet)).toBe(appWallet.scriptCbor);
  });

  test("missing scriptCbor stays undefined-safe", () => {
    const appWallet = wallet({ scriptCbor: undefined as unknown as string });
    expect(embeddedScript(appWallet)).toBeUndefined();
  });
});

describe("stale-scriptCbor repair via runtime nativeScript", () => {
  test("legacy wallet with stale DB scriptCbor embeds the runtime-rebuilt script that backs its address", () => {
    // Address derives from nativeScript (payment1), but the DB row stored a
    // different script — the shape that previously 400'd and needed
    // submit-time recovery on every transaction.
    const appWallet = wallet({
      address: a.address,
      scriptCbor: b.scriptCbor, // stale
      nativeScript: script(mockKeyHashes.payment1),
    });
    expect(resolveExpectedPaymentScriptCbor(appWallet, 0)).toBe(a.scriptCbor);
  });

  test("healthy wallet keeps its matching scriptCbor even when nativeScript diverges", () => {
    // scriptCbor matches the address, so the pre-existing check wins before
    // the rebuilt-script candidate is ever considered — behavior unchanged.
    const appWallet = wallet({
      address: a.address,
      scriptCbor: a.scriptCbor,
      nativeScript: script(mockKeyHashes.payment2),
    });
    expect(resolveExpectedPaymentScriptCbor(appWallet, 0)).toBe(a.scriptCbor);
  });

  test("stale scriptCbor with a nativeScript that matches nothing still falls back to scriptCbor", () => {
    const appWallet = wallet({
      address: c.address,
      scriptCbor: a.scriptCbor,
      nativeScript: script(mockKeyHashes.payment2),
    });
    expect(resolveExpectedPaymentScriptCbor(appWallet, 0)).toBe(a.scriptCbor);
  });

  test("script CBOR is network-independent — same result for any network argument", () => {
    const appWallet = wallet({
      address: a.address,
      scriptCbor: b.scriptCbor,
      nativeScript: script(mockKeyHashes.payment1),
    });
    expect(resolveExpectedPaymentScriptCbor(appWallet, 0)).toBe(
      resolveExpectedPaymentScriptCbor(appWallet, 1),
    );
    expect(resolveExpectedPaymentScriptCbor(appWallet)).toBe(a.scriptCbor);
  });
});
