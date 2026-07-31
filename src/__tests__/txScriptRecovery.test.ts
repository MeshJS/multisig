import { describe, expect, it, jest } from "@jest/globals";
import { serializeNativeScript, type NativeScript } from "@meshsdk/core";
import { csl } from "@meshsdk/core-csl";
import { resolveTxHash } from "@meshsdk/core-cst";

import type {
  MultisigSubmissionWallet,
  ScriptRecoveryWallet,
} from "@/types/txSign";
import { scriptHashFromCbor } from "@/utils/nativeScriptUtils";
import {
  buildLegacyStylePaymentScriptCbor,
  buildSerializedNativeScriptCbor,
  diagnoseTxWitnesses,
  extractMissingScriptHashFromError,
  getFirstNativeScriptCborFromTx,
  replaceNativeScriptWitness,
  shouldSubmitMultisigTx,
  submitTxWithScriptRecovery,
} from "@/utils/txScriptRecovery";
import { mockKeyHashes, realTestAddresses } from "./testUtils";

const signersAddresses = ["addr_test_1", "addr_test_2", "addr_test_3"];

function wallet(overrides: Partial<MultisigSubmissionWallet>): MultisigSubmissionWallet {
  return {
    type: "all",
    numRequiredSigners: null,
    signersAddresses,
    ...overrides,
  };
}

function sigScript(keyHash: string): NativeScript {
  return { type: "all", scripts: [{ type: "sig", keyHash }] };
}

const scriptA = serializeNativeScript(sigScript(mockKeyHashes.payment1), undefined, 0, true);
const scriptB = serializeNativeScript(sigScript(mockKeyHashes.payment2), undefined, 0, true);
const hashA = scriptHashFromCbor(scriptA.scriptCbor)!;

function recoveryWallet(overrides: Partial<ScriptRecoveryWallet> = {}): ScriptRecoveryWallet {
  return {
    type: "all",
    numRequiredSigners: 1,
    signersAddresses: [],
    scriptCbor: scriptA.scriptCbor,
    address: scriptA.address,
    ...overrides,
  } as ScriptRecoveryWallet;
}

function buildMinimalTxHex(): string {
  const inputs = csl.TransactionInputs.new();
  inputs.add(
    csl.TransactionInput.new(
      csl.TransactionHash.from_bytes(Buffer.from("00".repeat(32), "hex")),
      0,
    ),
  );

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
  return csl.Transaction.new(body, csl.TransactionWitnessSet.new(), undefined).to_hex();
}

function withVkeyWitnesses(
  txHex: string,
  entries: { signer: csl.PrivateKey; bodyHashHex: string }[],
): string {
  const tx = csl.Transaction.from_hex(txHex);
  const witnessSet = csl.TransactionWitnessSet.from_bytes(tx.witness_set().to_bytes());
  const vkeys = csl.Vkeywitnesses.new();
  for (const { signer, bodyHashHex } of entries) {
    vkeys.add(
      csl.Vkeywitness.new(
        csl.Vkey.new(signer.to_public()),
        signer.sign(Buffer.from(bodyHashHex, "hex")),
      ),
    );
  }
  witnessSet.set_vkeys(vkeys);
  return csl.Transaction.new(
    csl.TransactionBody.from_bytes(tx.body().to_bytes()),
    witnessSet,
    tx.auxiliary_data(),
  ).to_hex();
}

function pubKeyHex(signer: csl.PrivateKey): string {
  return Buffer.from(signer.to_public().as_bytes()).toString("hex").toLowerCase();
}

function witnessScriptHashes(txHex: string): (string | undefined)[] {
  const scripts = csl.Transaction.from_hex(txHex).witness_set().native_scripts();
  if (!scripts) return [];
  const hashes: (string | undefined)[] = [];
  for (let i = 0; i < scripts.len(); i++) {
    hashes.push(
      scriptHashFromCbor(Buffer.from(scripts.get(i).to_bytes()).toString("hex")),
    );
  }
  return hashes;
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

describe("extractMissingScriptHashFromError", () => {
  it("parses the hash out of a node MissingScriptWitnessesUTXOW failure", () => {
    const error = new Error(
      `transaction submit error ShelleyTxValidationError: ` +
        `MissingScriptWitnessesUTXOW (fromList [ScriptHash "${hashA}"])`,
    );
    expect(extractMissingScriptHashFromError(error)).toBe(hashA);
  });

  it("reads nested Blockfrost-style response messages and lowercases the hash", () => {
    const upper = hashA.toUpperCase();
    const error = {
      response: {
        data: {
          message: `MissingScriptWitnessesUTXOW (fromList [ScriptHash "${upper}"])`,
        },
      },
    };
    expect(extractMissingScriptHashFromError(error)).toBe(hashA);
  });

  it("falls back to any bare 56-hex hash in the message", () => {
    expect(extractMissingScriptHashFromError(new Error(`script ${hashA} missing`))).toBe(hashA);
  });

  it("returns undefined when no script hash is present", () => {
    expect(extractMissingScriptHashFromError(new Error("some other failure"))).toBeUndefined();
    expect(extractMissingScriptHashFromError(undefined)).toBeUndefined();
  });
});

describe("native script witness helpers", () => {
  it("round-trips a script through replaceNativeScriptWitness and getFirstNativeScriptCborFromTx", () => {
    const txHex = buildMinimalTxHex();
    expect(getFirstNativeScriptCborFromTx(txHex)).toBeUndefined();

    const withScript = replaceNativeScriptWitness(txHex, scriptA.scriptCbor);
    const embedded = getFirstNativeScriptCborFromTx(withScript);
    expect(embedded).toBeDefined();
    expect(scriptHashFromCbor(embedded)).toBe(hashA);
  });

  it("replaces an existing script witness instead of accumulating", () => {
    const txHex = replaceNativeScriptWitness(buildMinimalTxHex(), scriptA.scriptCbor);
    const swapped = replaceNativeScriptWitness(txHex, scriptB.scriptCbor);

    expect(witnessScriptHashes(swapped)).toEqual([scriptHashFromCbor(scriptB.scriptCbor)]);
  });

  it("keeps the transaction body byte-stable while swapping witnesses", () => {
    const txHex = buildMinimalTxHex();
    const repaired = replaceNativeScriptWitness(txHex, scriptA.scriptCbor);
    expect(resolveTxHash(repaired)).toEqual(resolveTxHash(txHex));
  });

  it("returns undefined for garbage tx hex", () => {
    expect(getFirstNativeScriptCborFromTx("not-hex")).toBeUndefined();
  });
});

describe("script rebuild helpers", () => {
  it("buildSerializedNativeScriptCbor serializes the wallet's runtime nativeScript", () => {
    const appWallet = recoveryWallet({ nativeScript: sigScript(mockKeyHashes.payment1) });
    expect(buildSerializedNativeScriptCbor(appWallet, 0)).toBe(scriptA.scriptCbor);
  });

  it("buildSerializedNativeScriptCbor returns undefined without a nativeScript", () => {
    expect(buildSerializedNativeScriptCbor(recoveryWallet(), 0)).toBeUndefined();
  });

  it("buildLegacyStylePaymentScriptCbor derives an all-of script from signer addresses", () => {
    const appWallet = recoveryWallet({
      signersAddresses: [realTestAddresses.address1, realTestAddresses.address2],
    });
    const cbor = buildLegacyStylePaymentScriptCbor(appWallet, 0);
    expect(cbor).toBeDefined();
    expect(scriptHashFromCbor(cbor)).toHaveLength(56);
  });

  it("buildLegacyStylePaymentScriptCbor honors the atLeast threshold", () => {
    const base = {
      signersAddresses: [realTestAddresses.address1, realTestAddresses.address2],
    };
    const atLeast = buildLegacyStylePaymentScriptCbor(
      recoveryWallet({ ...base, type: "atLeast", numRequiredSigners: 2 }),
      0,
    );
    const all = buildLegacyStylePaymentScriptCbor(recoveryWallet(base), 0);
    expect(atLeast).toBeDefined();
    expect(atLeast).not.toBe(all);
  });

  it("buildLegacyStylePaymentScriptCbor returns undefined without signer addresses", () => {
    expect(buildLegacyStylePaymentScriptCbor(recoveryWallet(), 0)).toBeUndefined();
  });
});

describe("diagnoseTxWitnesses", () => {
  it("reports zero stale witnesses when every vkey signed the submit body hash", () => {
    const txHex = buildMinimalTxHex();
    const signer = csl.PrivateKey.generate_ed25519();
    const signed = withVkeyWitnesses(txHex, [
      { signer, bodyHashHex: resolveTxHash(txHex) },
    ]);

    const diag = diagnoseTxWitnesses(signed);
    expect(diag.bodyHash).toBe(resolveTxHash(txHex).toLowerCase());
    expect(diag.total).toBe(1);
    expect(diag.stale).toEqual([]);
  });

  it("flags witnesses signed over a different body encoding", () => {
    const txHex = buildMinimalTxHex();
    const good = csl.PrivateKey.generate_ed25519();
    const bad = csl.PrivateKey.generate_ed25519();
    const signed = withVkeyWitnesses(txHex, [
      { signer: good, bodyHashHex: resolveTxHash(txHex) },
      { signer: bad, bodyHashHex: "ff".repeat(32) },
    ]);

    const diag = diagnoseTxWitnesses(signed);
    expect(diag.total).toBe(2);
    expect(diag.stale).toEqual([
      expect.objectContaining({ pubKeyHex: pubKeyHex(bad) }),
    ]);
  });
});

describe("submitTxWithScriptRecovery", () => {
  function submitterOf(impl: (txHex: string) => Promise<string>) {
    return { submitTx: jest.fn(impl) };
  }

  it("passes a clean submit through untouched", async () => {
    const txHex = buildMinimalTxHex();
    const submitter = submitterOf(async () => "hash-ok");

    const result = await submitTxWithScriptRecovery({ txHex, submitter });

    expect(result).toEqual({ txHash: "hash-ok", txHex, repaired: false });
    expect(submitter.submitTx).toHaveBeenCalledTimes(1);
    expect(submitter.submitTx).toHaveBeenCalledWith(txHex);
  });

  it("repairs a MissingScriptWitnessesUTXOW rejection with the wallet's script", async () => {
    // Tx carries the wrong script witness (B); the node names A as missing.
    const txHex = replaceNativeScriptWitness(buildMinimalTxHex(), scriptB.scriptCbor);
    const missingError = new Error(
      `MissingScriptWitnessesUTXOW (fromList [ScriptHash "${hashA}"])`,
    );
    let submitted: string[] = [];
    const submitter = submitterOf(async (hex) => {
      submitted.push(hex);
      if (submitted.length === 1) throw missingError;
      return "hash-repaired";
    });

    const result = await submitTxWithScriptRecovery({
      txHex,
      submitter,
      appWallet: recoveryWallet(),
      network: 0,
    });

    expect(result.repaired).toBe(true);
    expect(result.txHash).toBe("hash-repaired");
    // The resubmitted tx embeds the script whose hash the node demanded,
    // with the body untouched.
    expect(witnessScriptHashes(result.txHex)).toContain(hashA);
    expect(resolveTxHash(result.txHex)).toEqual(resolveTxHash(txHex));
  });

  it("rethrows when every candidate script set is rejected", async () => {
    const txHex = buildMinimalTxHex();
    const missingError = new Error(
      `MissingScriptWitnessesUTXOW (fromList [ScriptHash "${hashA}"])`,
    );
    const finalError = new Error("still rejected");
    const submitter = submitterOf(async () => {
      throw submitter.submitTx.mock.calls.length === 1 ? missingError : finalError;
    });

    await expect(
      submitTxWithScriptRecovery({
        txHex,
        submitter,
        appWallet: recoveryWallet(),
        network: 0,
      }),
    ).rejects.toBe(finalError);
    expect(submitter.submitTx.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not attempt repair without wallet context", async () => {
    const txHex = buildMinimalTxHex();
    const missingError = new Error(
      `MissingScriptWitnessesUTXOW (fromList [ScriptHash "${hashA}"])`,
    );
    const submitter = submitterOf(async () => {
      throw missingError;
    });

    await expect(submitTxWithScriptRecovery({ txHex, submitter })).rejects.toBe(missingError);
    expect(submitter.submitTx).toHaveBeenCalledTimes(1);
  });

  it("surfaces BadInputsUTxO as an unrecoverable rebuild-required error", async () => {
    const submitter = submitterOf(async () => {
      throw new Error("BadInputsUTxO (fromList [...])");
    });

    await expect(
      submitTxWithScriptRecovery({
        txHex: buildMinimalTxHex(),
        submitter,
        appWallet: recoveryWallet(),
        network: 0,
      }),
    ).rejects.toThrow(/inputs are no longer available on chain/);
    expect(submitter.submitTx).toHaveBeenCalledTimes(1);
  });

  it("surfaces ValueNotConservedUTxO with rebuild guidance", async () => {
    const submitter = submitterOf(async () => {
      throw new Error("ValueNotConservedUTxO expected X provided Y");
    });

    await expect(
      submitTxWithScriptRecovery({
        txHex: buildMinimalTxHex(),
        submitter,
        appWallet: recoveryWallet(),
        network: 0,
      }),
    ).rejects.toThrow(/ValueNotConservedUTxO/);
    expect(submitter.submitTx).toHaveBeenCalledTimes(1);
  });

  it("refuses to repair a PPViewHashesDontMatch rejection", async () => {
    const submitter = submitterOf(async () => {
      throw new Error("PPViewHashesDontMatch mismatch");
    });

    await expect(
      submitTxWithScriptRecovery({
        txHex: buildMinimalTxHex(),
        submitter,
        appWallet: recoveryWallet(),
        network: 0,
      }),
    ).rejects.toThrow(/cannot be repaired/);
    expect(submitter.submitTx).toHaveBeenCalledTimes(1);
  });

  it("strips the vkey witnesses an InvalidWitnessesUTXOW rejection names and resubmits", async () => {
    const base = buildMinimalTxHex();
    const good = csl.PrivateKey.generate_ed25519();
    const bad = csl.PrivateKey.generate_ed25519();
    const txHex = withVkeyWitnesses(base, [
      { signer: good, bodyHashHex: resolveTxHash(base) },
      { signer: bad, bodyHashHex: "ff".repeat(32) },
    ]);
    const invalidError = new Error(
      `InvalidWitnessesUTXOW [VKey (VerKeyEd25519DSIGN "${pubKeyHex(bad)}")]`,
    );
    let attempts = 0;
    const submitter = submitterOf(async () => {
      attempts += 1;
      if (attempts === 1) throw invalidError;
      return "hash-stripped";
    });

    const result = await submitTxWithScriptRecovery({ txHex, submitter });

    expect(result.repaired).toBe(true);
    expect(result.txHash).toBe("hash-stripped");
    const vkeys = csl.Transaction.from_hex(result.txHex).witness_set().vkeys();
    expect(vkeys?.len()).toBe(1);
    expect(
      Buffer.from(vkeys!.get(0).vkey().public_key().as_bytes()).toString("hex"),
    ).toBe(pubKeyHex(good));
  });
});
