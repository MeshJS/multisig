import { describe, expect, it } from "@jest/globals";
import { csl } from "@meshsdk/core-csl";
import { resolveTxHash } from "@meshsdk/core-cst";

import {
  addUniqueVkeyWitnessToTx,
  createVkeyWitnessFromHex,
  extractVkeyWitnesses,
  filterWitnessesToScripts,
  mergeSignerWitnesses,
} from "@/utils/txSignUtils";

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

// A witness-set-only payload (CIP-30 partial sign) signed over the core-cst
// body hash of `bodyHashHex` — i.e. exactly the bytes the wallet was handed.
function witnessSetHexFor(signer: csl.PrivateKey, bodyHashHex: string): string {
  const sig = signer.sign(Buffer.from(bodyHashHex, "hex"));
  const witness = csl.Vkeywitness.new(csl.Vkey.new(signer.to_public()), sig);
  const witnesses = csl.Vkeywitnesses.new();
  witnesses.add(witness);
  const witnessSet = csl.TransactionWitnessSet.new();
  witnessSet.set_vkeys(witnesses);
  return witnessSet.to_hex();
}

describe("mergeSignerWitnesses", () => {
  it("accepts a vkey signed over the core-cst body hash and preserves the body", () => {
    const txHex = buildMinimalTxHex();
    const signer = csl.PrivateKey.generate_ed25519();
    const payload = witnessSetHexFor(signer, resolveTxHash(txHex));

    const result = mergeSignerWitnesses(txHex, payload);

    expect(result.invalidVkeyPubKeysHex).toEqual([]);
    // Body bytes are unchanged: the persisted/submitted hash equals what the
    // wallet signed — no node-side InvalidWitnessesUTXOW.
    expect(resolveTxHash(result.txHex)).toEqual(resolveTxHash(txHex));
    expect(
      csl.Transaction.from_hex(result.txHex).witness_set().vkeys()?.len(),
    ).toBe(1);
  });

  it("flags a vkey whose signature targets a different body", () => {
    const txHex = buildMinimalTxHex();
    const signer = csl.PrivateKey.generate_ed25519();
    // Signed over a hash that isn't this body's — must be reported, not adopted.
    const payload = witnessSetHexFor(signer, "ff".repeat(32));

    const result = mergeSignerWitnesses(txHex, payload);

    const expectedPubKey = Buffer.from(signer.to_public().as_bytes())
      .toString("hex")
      .toLowerCase();
    expect(result.invalidVkeyPubKeysHex).toEqual([expectedPubKey]);
  });

  it("merges a co-signer without re-verifying existing witnesses and keeps the body stable", () => {
    const txHex = buildMinimalTxHex();
    const existingSigner = csl.PrivateKey.generate_ed25519();
    const newSigner = csl.PrivateKey.generate_ed25519();

    // Pre-seed an existing witness signed against the wrong body. The merge must
    // not re-flag it (only newly added witnesses are verified).
    const sig = existingSigner.sign(Buffer.from("ff".repeat(32), "hex"));
    const tx = csl.Transaction.from_hex(txHex);
    const witnessSet = csl.TransactionWitnessSet.from_bytes(
      tx.witness_set().to_bytes(),
    );
    const vkeys = csl.Vkeywitnesses.new();
    vkeys.add(csl.Vkeywitness.new(csl.Vkey.new(existingSigner.to_public()), sig));
    witnessSet.set_vkeys(vkeys);
    const seededTxHex = csl.Transaction.new(
      csl.TransactionBody.from_bytes(tx.body().to_bytes()),
      witnessSet,
      tx.auxiliary_data(),
    ).to_hex();

    const goodPayload = witnessSetHexFor(newSigner, resolveTxHash(seededTxHex));
    const result = mergeSignerWitnesses(seededTxHex, goodPayload);

    expect(result.invalidVkeyPubKeysHex).toEqual([]);
    expect(resolveTxHash(result.txHex)).toEqual(resolveTxHash(seededTxHex));
    expect(
      csl.Transaction.from_hex(result.txHex).witness_set().vkeys()?.len(),
    ).toBe(2);
  });
});

describe("filterWitnessesToScripts", () => {
  it("drops vkeys not required by the native script while preserving the body", () => {
    // Build a tx whose witness set carries a native script requiring signer A,
    // plus vkey witnesses from A (required) and B (extraneous).
    const A = csl.PrivateKey.generate_ed25519();
    const B = csl.PrivateKey.generate_ed25519();

    const inputs = csl.TransactionInputs.new();
    inputs.add(
      csl.TransactionInput.new(
        csl.TransactionHash.from_bytes(Buffer.from("00".repeat(32), "hex")),
        0,
      ),
    );
    const outputs = csl.TransactionOutputs.new();
    const outAddr = csl.EnterpriseAddress.new(
      csl.NetworkInfo.testnet_preview().network_id(),
      csl.Credential.from_keyhash(A.to_public().hash()),
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

    const nativeScript = csl.ScriptPubkey.new(A.to_public().hash());
    const scripts = csl.NativeScripts.new();
    scripts.add(csl.NativeScript.new_script_pubkey(nativeScript));

    const probeHex = csl.Transaction.new(
      csl.TransactionBody.from_bytes(body.to_bytes()),
      csl.TransactionWitnessSet.new(),
      undefined,
    ).to_hex();
    const bodyHash = resolveTxHash(probeHex);

    const vkeys = csl.Vkeywitnesses.new();
    vkeys.add(csl.Vkeywitness.new(csl.Vkey.new(A.to_public()), A.sign(Buffer.from(bodyHash, "hex"))));
    vkeys.add(csl.Vkeywitness.new(csl.Vkey.new(B.to_public()), B.sign(Buffer.from(bodyHash, "hex"))));
    const witnessSet = csl.TransactionWitnessSet.new();
    witnessSet.set_vkeys(vkeys);
    witnessSet.set_native_scripts(scripts);

    const txHex = csl.Transaction.new(
      csl.TransactionBody.from_bytes(body.to_bytes()),
      witnessSet,
      undefined,
    ).to_hex();

    const filtered = filterWitnessesToScripts(txHex);

    // B is dropped, A kept, body unchanged.
    expect(
      csl.Transaction.from_hex(filtered).witness_set().vkeys()?.len(),
    ).toBe(1);
    expect(resolveTxHash(filtered)).toEqual(resolveTxHash(txHex));
    const keptPub = csl.Transaction.from_hex(filtered)
      .witness_set()
      .vkeys()!
      .get(0)
      .vkey()
      .public_key()
      .as_bytes();
    expect(Buffer.from(keptPub).toString("hex")).toEqual(
      Buffer.from(A.to_public().as_bytes()).toString("hex"),
    );
  });
});

describe("extractVkeyWitnesses", () => {
  it("reads vkeys from a full signed transaction payload", () => {
    const txHex = buildMinimalTxHex();
    const signer = csl.PrivateKey.generate_ed25519();
    const sig = signer.sign(Buffer.from(resolveTxHash(txHex), "hex"));
    const tx = csl.Transaction.from_hex(txHex);
    const witnessSet = csl.TransactionWitnessSet.from_bytes(
      tx.witness_set().to_bytes(),
    );
    const vkeys = csl.Vkeywitnesses.new();
    vkeys.add(csl.Vkeywitness.new(csl.Vkey.new(signer.to_public()), sig));
    witnessSet.set_vkeys(vkeys);
    const signedTxHex = csl.Transaction.new(
      csl.TransactionBody.from_bytes(tx.body().to_bytes()),
      witnessSet,
      tx.auxiliary_data(),
    ).to_hex();

    const extracted = extractVkeyWitnesses(signedTxHex);
    expect(extracted.len()).toBe(1);
    expect(
      Buffer.from(extracted.get(0).vkey().public_key().as_bytes()).toString("hex"),
    ).toEqual(Buffer.from(signer.to_public().as_bytes()).toString("hex"));
  });

  it("falls back to parsing a witness-set-only payload (CIP-30 partial sign)", () => {
    const signer = csl.PrivateKey.generate_ed25519();
    const payload = witnessSetHexFor(signer, "ab".repeat(32));

    const extracted = extractVkeyWitnesses(payload);
    expect(extracted.len()).toBe(1);
  });

  it("returns an empty set when the payload carries no vkeys", () => {
    expect(extractVkeyWitnesses(buildMinimalTxHex()).len()).toBe(0);
    expect(
      extractVkeyWitnesses(csl.TransactionWitnessSet.new().to_hex()).len(),
    ).toBe(0);
  });
});

describe("createVkeyWitnessFromHex", () => {
  it("builds a witness whose key hash matches the public key", () => {
    const signer = csl.PrivateKey.generate_ed25519();
    const bodyHash = "cd".repeat(32);
    const signatureHex = signer.sign(Buffer.from(bodyHash, "hex")).to_hex();
    const keyHex = signer.to_public().to_hex();

    const created = createVkeyWitnessFromHex(keyHex, signatureHex);

    expect(created.keyHashHex).toBe(
      Buffer.from(signer.to_public().hash().to_bytes()).toString("hex"),
    );
    expect(created.witness.signature().to_hex()).toBe(signatureHex);
    expect(
      created.publicKey.verify(
        Buffer.from(bodyHash, "hex"),
        created.signature,
      ),
    ).toBe(true);
  });
});

describe("addUniqueVkeyWitnessToTx", () => {
  it("adds a new vkey witness while preserving the body bytes", () => {
    const txHex = buildMinimalTxHex();
    const signer = csl.PrivateKey.generate_ed25519();
    const sig = signer.sign(Buffer.from(resolveTxHash(txHex), "hex"));
    const witness = csl.Vkeywitness.new(csl.Vkey.new(signer.to_public()), sig);

    const result = addUniqueVkeyWitnessToTx(txHex, witness);

    expect(result.witnessAdded).toBe(true);
    expect(result.vkeyWitnesses.len()).toBe(1);
    expect(resolveTxHash(result.txHex)).toEqual(resolveTxHash(txHex));
    expect(
      csl.Transaction.from_hex(result.txHex).witness_set().vkeys()?.len(),
    ).toBe(1);
  });

  it("is a no-op when the same key hash is already witnessed", () => {
    const txHex = buildMinimalTxHex();
    const signer = csl.PrivateKey.generate_ed25519();
    const sig = signer.sign(Buffer.from(resolveTxHash(txHex), "hex"));
    const witness = csl.Vkeywitness.new(csl.Vkey.new(signer.to_public()), sig);

    const once = addUniqueVkeyWitnessToTx(txHex, witness);
    const twice = addUniqueVkeyWitnessToTx(once.txHex, witness);

    expect(twice.witnessAdded).toBe(false);
    expect(twice.txHex).toBe(once.txHex);
    expect(twice.vkeyWitnesses.len()).toBe(1);
  });
});
