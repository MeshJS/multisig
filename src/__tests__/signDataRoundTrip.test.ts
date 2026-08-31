import { describe, expect, it } from "@jest/globals";
import { MeshWallet, checkSignature, generateNonce } from "@meshsdk/core";

import { sign } from "@/utils/signing";

/**
 * End-to-end round trip for `sign()`, against the REAL @meshsdk helpers.
 *
 * The existing signing.test.ts mocks `checkSignature` and `generateNonce`, so it
 * proves the control flow (throw when verification fails) but can never prove
 * that verification actually succeeds for a genuine signature. A bug lived in
 * exactly that gap: `sign()` verified against `generateNonce(payload)` — which
 * is `hex(payload + 32 random characters)` — while the wallet had signed
 * `payload`, so verification returned false for every honest signature and
 * `sign()` threw "Signature failed verification" every single time.
 *
 * This test signs with a real key and asserts the round trip closes, so no mock
 * can hide the same class of defect again.
 */

// Deterministic throwaway key. Never used for anything but this test.
const MNEMONIC = Array<string>(24).fill("solution");

async function testWallet() {
  const wallet = new MeshWallet({
    networkId: 0,
    key: { type: "mnemonic", words: MNEMONIC },
  });
  await wallet.init();
  const address =
    (await wallet.getUsedAddresses())[0] ??
    (await wallet.getUnusedAddresses())[0];
  if (!address) throw new Error("test wallet produced no address");
  return { wallet, address };
}

// A canonical sign-off statement, the shape src/lib/documents/payload.ts emits.
const PAYLOAD = JSON.stringify({
  action: "approve",
  contentHash: "a".repeat(64),
  domain: "mesh-multisig.document-signoff.v1",
  versionNumber: 1,
});

describe("sign() round trip against real @meshsdk helpers", () => {
  it("returns a signature that verifies, instead of throwing", async () => {
    const { wallet, address } = await testWallet();

    const signature = await sign(PAYLOAD, wallet, 0, address);

    expect(signature.signature).toEqual(expect.any(String));
    expect(signature.key).toEqual(expect.any(String));
    await expect(checkSignature(PAYLOAD, signature, address)).resolves.toBe(
      true,
    );
  }, 60_000);

  it("verifies against the payload, never against a freshly generated nonce", async () => {
    // This is the defect stated as a property. `generateNonce` appends random
    // characters, so a nonce built client-side cannot be what the wallet signed.
    // Verifying against it is always false — which is why sign() must not.
    const { wallet, address } = await testWallet();
    const signature = await wallet.signData(PAYLOAD, address);

    await expect(checkSignature(PAYLOAD, signature, address)).resolves.toBe(
      true,
    );
    await expect(
      checkSignature(generateNonce(PAYLOAD), signature, address),
    ).resolves.toBe(false);
  }, 60_000);

  it("rejects a signature made over different bytes", async () => {
    const { wallet, address } = await testWallet();
    const signature = await wallet.signData(PAYLOAD, address);

    await expect(
      checkSignature(`${PAYLOAD} tampered`, signature, address),
    ).resolves.toBe(false);
  }, 60_000);
});
