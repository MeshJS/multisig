import { describe, expect, it } from "@jest/globals";
import { csl, calculateTxHash } from "@meshsdk/core-csl";

import { mergeSignerWitnesses } from "@/utils/txSignUtils";

function buildMinimalTxHex(): string {
  const inputs = csl.TransactionInputs.new();
  const inputHash = csl.TransactionHash.from_bytes(
    Buffer.from("00".repeat(32), "hex"),
  );
  inputs.add(csl.TransactionInput.new(inputHash, 0));

  const outputs = csl.TransactionOutputs.new();
  const sinkKey = csl.PrivateKey.generate_ed25519().to_public();
  const outAddr = csl.EnterpriseAddress.new(
    csl.NetworkInfo.testnet_preview().network_id(),
    csl.Credential.from_keyhash(sinkKey.hash()),
  ).to_address();
  outputs.add(
    csl.TransactionOutput.new(outAddr, csl.Value.new(csl.BigNum.from_str("1000000"))),
  );

  const body = csl.TransactionBody.new(
    inputs,
    outputs,
    csl.BigNum.from_str("100000"),
    undefined,
  );
  const witnesses = csl.TransactionWitnessSet.new();
  return csl.Transaction.new(body, witnesses, undefined).to_hex();
}

function witnessSetHexFor(
  signer: csl.PrivateKey,
  bodyHashHex: string,
): string {
  const sig = signer.sign(Buffer.from(bodyHashHex, "hex"));
  const witness = csl.Vkeywitness.new(csl.Vkey.new(signer.to_public()), sig);
  const witnesses = csl.Vkeywitnesses.new();
  witnesses.add(witness);

  const witnessSet = csl.TransactionWitnessSet.new();
  witnessSet.set_vkeys(witnesses);
  return witnessSet.to_hex();
}

// Build a full signed Transaction hex whose body bytes differ from
// `originalTxHex` (one input flipped) and whose vkey signature targets the
// wallet's body — the shape a wallet returns when it re-canonicalises CBOR
// before signing.
function fullSignedTxHexWithDifferentBody(
  originalTxHex: string,
  signer: csl.PrivateKey,
): { hex: string; walletBodyHashHex: string } {
  const inputs = csl.TransactionInputs.new();
  inputs.add(
    csl.TransactionInput.new(
      csl.TransactionHash.from_bytes(Buffer.from("11".repeat(32), "hex")),
      0,
    ),
  );

  const orig = csl.Transaction.from_hex(originalTxHex);
  const body = csl.TransactionBody.new(
    inputs,
    orig.body().outputs(),
    orig.body().fee(),
    undefined,
  );

  // Build a transient tx (no witnesses) just to take its body hash.
  const probeHex = csl.Transaction.new(
    body,
    csl.TransactionWitnessSet.new(),
    undefined,
  ).to_hex();
  const walletBodyHashHex = calculateTxHash(probeHex);

  const sig = signer.sign(Buffer.from(walletBodyHashHex, "hex"));
  const vkeys = csl.Vkeywitnesses.new();
  vkeys.add(csl.Vkeywitness.new(csl.Vkey.new(signer.to_public()), sig));
  const witnessSet = csl.TransactionWitnessSet.new();
  witnessSet.set_vkeys(vkeys);

  // Re-parse the body so it's not consumed by the probe tx above.
  return {
    hex: csl.Transaction.new(
      csl.TransactionBody.from_bytes(body.to_bytes()),
      witnessSet,
      undefined,
    ).to_hex(),
    walletBodyHashHex,
  };
}

describe("mergeSignerWitnesses", () => {
  it("returns an empty invalidVkeyPubKeysHex when the new vkey verifies", () => {
    const txHex = buildMinimalTxHex();
    const signer = csl.PrivateKey.generate_ed25519();
    const payload = witnessSetHexFor(signer, calculateTxHash(txHex));

    const result = mergeSignerWitnesses(txHex, payload);

    expect(result.invalidVkeyPubKeysHex).toEqual([]);
    expect(
      csl.Transaction.from_hex(result.txHex).witness_set().vkeys()?.len(),
    ).toBe(1);
  });

  it("flags a vkey whose signature targets a different body", () => {
    const txHex = buildMinimalTxHex();
    const signer = csl.PrivateKey.generate_ed25519();

    // Sign a hash that does NOT match the body — simulates a wallet that
    // re-canonicalised the CBOR before signing, producing a witness whose
    // signature verifies against the wallet's re-encoded body but not ours.
    const payload = witnessSetHexFor(signer, "ff".repeat(32));

    const result = mergeSignerWitnesses(txHex, payload);

    const expectedPubKey = Buffer.from(signer.to_public().as_bytes())
      .toString("hex")
      .toLowerCase();
    expect(result.invalidVkeyPubKeysHex).toEqual([expectedPubKey]);

    // The merged tx still contains the witness (callers decide what to do);
    // we just surface the validity verdict.
    expect(
      csl.Transaction.from_hex(result.txHex).witness_set().vkeys()?.len(),
    ).toBe(1);
  });

  it("adopts the wallet's body when the wallet returned a full signed tx whose body differs and there are no pre-existing witnesses", () => {
    // First-signer scenario: the wallet re-canonicalised the body before
    // signing. We should use the wallet's body (so the signature verifies)
    // and report no invalid vkeys.
    const txHex = buildMinimalTxHex();
    const signer = csl.PrivateKey.generate_ed25519();
    const { hex: walletSignedHex, walletBodyHashHex } =
      fullSignedTxHexWithDifferentBody(txHex, signer);

    // Sanity: the wallet's body hash is NOT the original body hash.
    expect(walletBodyHashHex).not.toEqual(calculateTxHash(txHex));

    const result = mergeSignerWitnesses(txHex, walletSignedHex);

    expect(result.invalidVkeyPubKeysHex).toEqual([]);
    expect(calculateTxHash(result.txHex)).toEqual(walletBodyHashHex);
  });

  it("does not re-verify witnesses that were already present", () => {
    const txHex = buildMinimalTxHex();
    const existingSigner = csl.PrivateKey.generate_ed25519();
    const newSigner = csl.PrivateKey.generate_ed25519();

    // Pre-seed an "invalid" existing witness (signed against the wrong body).
    // mergeSignerWitnesses should not flag it; only newly merged ones.
    const wrongHashHex = "ff".repeat(32);
    const sig = existingSigner.sign(Buffer.from(wrongHashHex, "hex"));
    const existingWitness = csl.Vkeywitness.new(
      csl.Vkey.new(existingSigner.to_public()),
      sig,
    );
    const tx = csl.Transaction.from_hex(txHex);
    const witnessSet = csl.TransactionWitnessSet.from_bytes(
      tx.witness_set().to_bytes(),
    );
    const vkeys = csl.Vkeywitnesses.new();
    vkeys.add(existingWitness);
    witnessSet.set_vkeys(vkeys);
    const seededTxHex = csl.Transaction.new(
      csl.TransactionBody.from_bytes(tx.body().to_bytes()),
      witnessSet,
      tx.auxiliary_data(),
    ).to_hex();

    // Merge a valid signature from a different signer.
    const goodPayload = witnessSetHexFor(
      newSigner,
      calculateTxHash(seededTxHex),
    );
    const result = mergeSignerWitnesses(seededTxHex, goodPayload);

    expect(result.invalidVkeyPubKeysHex).toEqual([]);
    expect(
      csl.Transaction.from_hex(result.txHex).witness_set().vkeys()?.len(),
    ).toBe(2);
  });
});
