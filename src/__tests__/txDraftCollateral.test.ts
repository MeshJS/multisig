import {
  MeshTxBuilder,
  DEFAULT_PROTOCOL_PARAMETERS,
  resolvePlutusScriptAddress,
  type UTxO,
} from "@meshsdk/core";
import { csl } from "@meshsdk/core-csl";
import { resolveTxHash } from "@meshsdk/core-cst";
import {
  applyCollateral,
  discoverCollateral,
  inspectCollateral,
  requiredCollateral,
  resolveDraftCollateral,
  reviewCollateral,
  reviewCompletedCollateral,
} from "@/lib/tx-draft/collateral";
import { createDraft } from "@/lib/tx-draft/mutations";
import {
  transactionReadiness,
  requiredSignerKeyHashes,
  verifiedWitnessKeyHashes,
} from "@/utils/transactionReadiness";
import {
  addUniqueVkeyWitnessToTx,
  filterWitnessesToScripts,
  mergeSignerWitnesses,
} from "@/utils/txSignUtils";
import { replaceNativeScriptWitness } from "@/utils/txScriptRecovery";

const member = csl.PrivateKey.generate_ed25519();
const owner = csl.PrivateKey.generate_ed25519();
const ownerHash = owner.to_public().hash().to_hex();
const address = csl.EnterpriseAddress.new(
  0,
  csl.Credential.from_keyhash(owner.to_public().hash()),
)
  .to_address()
  .to_bech32();
const utxo: UTxO = {
  input: { txHash: "a".repeat(64), outputIndex: 0 },
  output: { address, amount: [{ unit: "lovelace", quantity: "2000000" }] },
};
const protocol = { collateralPercent: 150, maxCollateralInputs: 3 };
const provider = (live: UTxO[] = [utxo]) => ({
  fetchUTxOs: jest.fn().mockResolvedValue([utxo]),
  fetchAddressUTxOs: jest.fn().mockResolvedValue(live),
});
const wallet = () => ({
  getNetworkId: jest.fn().mockResolvedValue(0),
  getUtxos: jest.fn().mockResolvedValue([utxo]),
});
const draft = () => ({ ...createDraft(), collateral: { utxoRef: utxo.input } });

function unsigned() {
  const inputs = csl.TransactionInputs.new();
  inputs.add(
    csl.TransactionInput.new(csl.TransactionHash.from_hex("b".repeat(64)), 0),
  );
  const collateral = csl.TransactionInputs.new();
  collateral.add(
    csl.TransactionInput.new(
      csl.TransactionHash.from_hex(utxo.input.txHash),
      0,
    ),
  );
  const outputs = csl.TransactionOutputs.new();
  const output = csl.TransactionOutput.new(
    csl.Address.from_bech32(address),
    csl.Value.new(csl.BigNum.from_str("1000000")),
  );
  output.set_plutus_data(csl.PlutusData.new_integer(csl.BigInt.from_str("42")));
  outputs.add(output);
  const body = csl.TransactionBody.new(
    inputs,
    outputs,
    csl.BigNum.from_str("200001"),
  );
  body.set_collateral(collateral);
  const signers = csl.Ed25519KeyHashes.new();
  signers.add(owner.to_public().hash());
  body.set_required_signers(signers);
  const witnessSet = csl.TransactionWitnessSet.new();
  const scripts = csl.NativeScripts.new();
  scripts.add(
    csl.NativeScript.new_script_pubkey(
      csl.ScriptPubkey.new(member.to_public().hash()),
    ),
  );
  witnessSet.set_native_scripts(scripts);
  const plutus = csl.PlutusScripts.new();
  plutus.add(csl.PlutusScript.from_hex("49480100002221200101"));
  witnessSet.set_plutus_scripts(plutus);
  const datums = csl.PlutusList.new();
  datums.add(csl.PlutusData.new_integer(csl.BigInt.from_str("42")));
  witnessSet.set_plutus_data(datums);
  const redeemers = csl.Redeemers.new();
  redeemers.add(
    csl.Redeemer.new(
      csl.RedeemerTag.new_spend(),
      csl.BigNum.from_str("0"),
      csl.PlutusData.new_integer(csl.BigInt.from_str("0")),
      csl.ExUnits.new(csl.BigNum.from_str("10"), csl.BigNum.from_str("20")),
    ),
  );
  witnessSet.set_redeemers(redeemers);
  const metadata = csl.GeneralTransactionMetadata.new();
  metadata.insert(
    csl.BigNum.from_str("674"),
    csl.TransactionMetadatum.new_text("preserve me"),
  );
  const aux = csl.AuxiliaryData.new();
  aux.set_metadata(metadata);
  body.set_auxiliary_data_hash(csl.hash_auxiliary_data(aux));
  return csl.Transaction.new(body, witnessSet, aux).to_hex();
}
function witness(tx: string, key: csl.PrivateKey) {
  return csl.Vkeywitness.new(
    csl.Vkey.new(key.to_public()),
    key.sign(Buffer.from(resolveTxHash(tx), "hex")),
  );
}
const sign = (tx: string, key: csl.PrivateKey) =>
  addUniqueVkeyWitnessToTx(tx, witness(tx, key)).txHex;

describe("connected-wallet collateral", () => {
  test("discovers via getUtxos when deprecated collateral API is missing or refuses", async () => {
    for (const w of [
      wallet(),
      {
        ...wallet(),
        getCollateral: jest.fn().mockRejectedValue(new Error("unsupported")),
      },
    ]) {
      expect(await discoverCollateral(w, 0, provider())).toEqual([
        inspectCollateral(utxo, 0),
      ]);
    }
  });
  test("deduplicates APIs and derives actual owner and amount from live chain data", async () => {
    const w = {
      ...wallet(),
      getCollateral: jest.fn().mockResolvedValue([utxo]),
    };
    const live = {
      ...utxo,
      output: {
        ...utxo.output,
        amount: [{ unit: "lovelace", quantity: "1700000" }],
      },
    };
    const p = provider([live]);
    expect(await discoverCollateral(w, 0, p)).toEqual([
      { utxo: live, ownerKeyHash: ownerHash, lovelace: "1700000" },
    ]);
    expect(p.fetchAddressUTxOs).toHaveBeenCalledTimes(1);
  });
  test("rejects script, token, wrong-network and spent outputs", async () => {
    const scriptAddress = resolvePlutusScriptAddress(
      { code: "49480100002221200101", version: "V2" },
      0,
    );
    expect(() =>
      inspectCollateral(
        { ...utxo, output: { ...utxo.output, address: scriptAddress } },
        0,
      ),
    ).toThrow(/payment key/);
    expect(() =>
      inspectCollateral(
        {
          ...utxo,
          output: {
            ...utxo.output,
            amount: [...utxo.output.amount, { unit: "token", quantity: "1" }],
          },
        },
        0,
      ),
    ).toThrow(/only ADA/);
    expect(() => inspectCollateral(utxo, 1)).toThrow(/network/);
    await expect(discoverCollateral(wallet(), 1, provider())).rejects.toThrow(
      /network/,
    );
    expect(await discoverCollateral(wallet(), 0, provider([]))).toEqual([]);
  });
  test("fresh build resolution rejects spent, other-account, overlapping and superseded selections", async () => {
    expect(
      await resolveDraftCollateral(draft(), wallet(), 0, provider()),
    ).toMatchObject({ ownerKeyHash: ownerHash });
    await expect(
      resolveDraftCollateral(draft(), wallet(), 0, provider([])),
    ).rejects.toThrow(/spent/);
    await expect(
      resolveDraftCollateral(
        draft(),
        { ...wallet(), getUtxos: jest.fn().mockResolvedValue([]) },
        0,
        provider(),
      ),
    ).rejects.toThrow(/no longer supplied/);
    await expect(
      resolveDraftCollateral(
        { ...draft(), utxoSelection: { mode: "manual", utxos: [utxo] } },
        wallet(),
        0,
        provider(),
      ),
    ).rejects.toThrow(/spending input/);
    let finish!: (utxos: UTxO[]) => void;
    let current = true;
    const p = provider();
    p.fetchAddressUTxOs.mockImplementation(
      () =>
        new Promise<UTxO[]>((resolve) => {
          finish = resolve;
        }),
    );
    const task = resolveDraftCollateral(draft(), wallet(), 0, p, () => current);
    while (!finish) await Promise.resolve();
    current = false;
    finish([utxo]);
    await expect(task).rejects.toThrow(/superseded/);
  });
  test("uses integer ceil with current percentage, one-input policy and no fixed ADA floor", () => {
    expect(requiredCollateral("200001", protocol)).toBe(300002n);
    expect(
      requiredCollateral("1", { ...protocol, collateralPercent: 200 }),
    ).toBe(2n);
    expect(requiredCollateral("9007199254740993", protocol)).toBe(
      13510798882111490n,
    );
    expect(() =>
      requiredCollateral("1", { ...protocol, maxCollateralInputs: 0 }),
    ).toThrow();
    expect(() => requiredCollateral("1", protocol, 2)).toThrow();
    expect(() =>
      requiredCollateral("1", { ...protocol, collateralPercent: NaN }),
    ).toThrow();
  });
  test("Mesh emits collateral and owner signer in both CBOR and stored body", async () => {
    const b = new MeshTxBuilder();
    b.txIn(
      "b".repeat(64),
      0,
      [{ unit: "lovelace", quantity: "10000000" }],
      address,
      0,
    )
      .txOut(address, [{ unit: "lovelace", quantity: "2000000" }])
      .changeAddress(address);
    applyCollateral(b, inspectCollateral(utxo, 0));
    const tx = await b.complete();
    expect(requiredSignerKeyHashes(tx)).toEqual([ownerHash]);
    expect(
      JSON.parse(JSON.stringify(b.meshTxBuilderBody)).requiredSignatures,
    ).toContain(ownerHash);
    expect(
      reviewCollateral(tx, inspectCollateral(utxo, 0), protocol),
    ).toMatchObject({ maximumExposureLovelace: "2000000" });
  });
  test("post-evaluation review fetches current parameters and rejects stale or unavailable results", async () => {
    const p = {
      fetchProtocolParameters: jest
        .fn()
        .mockResolvedValue({
          ...DEFAULT_PROTOCOL_PARAMETERS,
          ...protocol,
          collateralPercent: 200,
        }),
    };
    const candidate = inspectCollateral(utxo, 0);
    expect(
      await reviewCompletedCollateral(unsigned(), candidate, p),
    ).toMatchObject({ minimumLovelace: "400002" });
    expect(p.fetchProtocolParameters).toHaveBeenCalledWith();
    await expect(
      reviewCompletedCollateral(unsigned(), candidate, p, () => false),
    ).rejects.toThrow(/superseded/);
    p.fetchProtocolParameters.mockRejectedValue(
      new Error("provider unavailable"),
    );
    await expect(
      reviewCompletedCollateral(unsigned(), candidate, p),
    ).rejects.toThrow(/provider unavailable/);
  });
  test("checks final fee, full exposure, explicit signer, count and return fields", () => {
    const tx = unsigned();
    const candidate = inspectCollateral(utxo, 0);
    expect(reviewCollateral(tx, candidate, protocol)).toMatchObject({
      minimumLovelace: "300002",
      maximumExposureLovelace: "2000000",
    });
    expect(() =>
      reviewCollateral(tx, { ...candidate, lovelace: "300001" }, protocol),
    ).toThrow(/Insufficient collateral/);
    const parsed = csl.Transaction.from_hex(tx);
    const body = parsed.body();
    body.set_total_collateral(csl.BigNum.from_str("300002"));
    expect(() =>
      reviewCollateral(
        csl.Transaction.new(
          body,
          parsed.witness_set(),
          parsed.auxiliary_data(),
        ).to_hex(),
        candidate,
        protocol,
      ),
    ).toThrow(/full exposure/);
    body.set_collateral_return(body.outputs().get(0));
    expect(() =>
      reviewCollateral(
        csl.Transaction.new(
          body,
          parsed.witness_set(),
          parsed.auxiliary_data(),
        ).to_hex(),
        candidate,
        protocol,
      ),
    ).toThrow(/return management/);
  });
});

describe("verified collateral witnesses and multisig readiness", () => {
  test("threshold without owner, owner without multisig, and signatures without authorization are insufficient", async () => {
    const tx = unsigned();
    expect(
      await transactionReadiness(sign(tx, member), true, provider(), 0),
    ).toMatchObject({ ready: false, missingKeyHashes: [ownerHash] });
    expect(
      await transactionReadiness(sign(tx, owner), true, provider(), 0),
    ).toMatchObject({ ready: false, nativeSatisfied: false });
    const both = sign(sign(tx, owner), member);
    expect(
      await transactionReadiness(both, false, provider(), 0),
    ).toMatchObject({ ready: false });
    expect(await transactionReadiness(both, true, provider(), 0)).toMatchObject(
      { ready: true },
    );
    await expect(
      transactionReadiness(both, true, provider([]), 0),
    ).rejects.toThrow(/no longer unspent/);
  });
  test("refusal, empty response, or signature of another body never satisfies owner", async () => {
    const tx = sign(unsigned(), member);
    const empty = mergeSignerWitnesses(
      tx,
      csl.TransactionWitnessSet.new().to_hex(),
    );
    expect(
      await transactionReadiness(empty.txHex, true, provider(), 0),
    ).toMatchObject({ ready: false, missingKeyHashes: [ownerHash] });
    const bad = csl.Vkeywitness.new(
      csl.Vkey.new(owner.to_public()),
      owner.sign(Buffer.from("ff".repeat(32), "hex")),
    );
    const badTx = addUniqueVkeyWitnessToTx(tx, bad).txHex;
    expect(
      await transactionReadiness(badTx, true, provider(), 0),
    ).toMatchObject({ ready: false, missingKeyHashes: [ownerHash] });
  });
  test("merges outside-script owner and key-input witnesses without changing body, scripts, datum, redeemer or auxiliary data", () => {
    const original = unsigned();
    const extra = csl.PrivateKey.generate_ed25519();
    const signed = sign(sign(original, member), owner);
    const witnesses = csl.TransactionWitnessSet.new();
    const keys = csl.Vkeywitnesses.new();
    keys.add(witness(original, extra));
    witnesses.set_vkeys(keys);
    const merged = filterWitnessesToScripts(
      mergeSignerWitnesses(signed, witnesses.to_hex()).txHex,
    );
    expect(verifiedWitnessKeyHashes(merged).size).toBe(3);
    expect(resolveTxHash(merged)).toBe(resolveTxHash(original));
    const before = csl.Transaction.from_hex(original);
    const after = csl.Transaction.from_hex(merged);
    expect(after.body().to_hex()).toBe(before.body().to_hex());
    expect(after.auxiliary_data()?.to_hex()).toBe(
      before.auxiliary_data()?.to_hex(),
    );
    expect(after.witness_set().plutus_scripts()?.to_hex()).toBe(
      before.witness_set().plutus_scripts()?.to_hex(),
    );
    expect(after.witness_set().plutus_data()?.to_hex()).toBe(
      before.witness_set().plutus_data()?.to_hex(),
    );
    expect(after.witness_set().redeemers()?.to_hex()).toBe(
      before.witness_set().redeemers()?.to_hex(),
    );
    const recovered = replaceNativeScriptWitness(
      merged,
      before.witness_set().native_scripts()!.get(0).to_hex(),
    );
    expect(resolveTxHash(recovered)).toBe(resolveTxHash(original));
    expect(verifiedWitnessKeyHashes(recovered).size).toBe(3);
    expect(
      csl.Transaction.from_hex(recovered).witness_set().redeemers()?.to_hex(),
    ).toBe(before.witness_set().redeemers()?.to_hex());
  });
});
