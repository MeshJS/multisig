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
