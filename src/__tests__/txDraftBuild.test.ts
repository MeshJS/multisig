import {
  MeshTxBuilder,
  DEFAULT_PROTOCOL_PARAMETERS,
  DEFAULT_V1_COST_MODEL_LIST,
  DEFAULT_V2_COST_MODEL_LIST,
  DEFAULT_V3_COST_MODEL_LIST,
  resolvePlutusScriptAddress,
  resolveDataHash,
  type UTxO,
  type IEvaluator,
  type IFetcher,
} from "@meshsdk/core";
import { csl } from "@meshsdk/core-csl";
import { resolveTxHash } from "@meshsdk/core-cst";

import { buildDraftTx } from "@/lib/tx-draft/build-draft-tx";
import {
  addOutput,
  createDraft,
  setUtxoSelection,
} from "@/lib/tx-draft/mutations";
import type { TxDraft } from "@/types/tx-draft";
import { realTestAddresses } from "./testUtils";
import {
  completeTxWithFreshCostModels,
  refreshScriptDataHash,
} from "@/lib/completeTxWithFreshCostModels";
import type { DraftScriptInput } from "@/types/tx-draft";
import type { BuildDraftTxOptions } from "@/lib/tx-draft/build-draft-tx";
import type { ApplyDraftContext } from "@/lib/tx-draft/to-tx-builder";
import { isDraftCompatible, txJsonToDraft } from "@/lib/tx-draft/from-tx-json";
import { createOutputProvenance } from "@/lib/tx-draft/outputs";
import { mergeSignerWitnesses } from "@/utils/txSignUtils";
import { invalidateDraftContext } from "@/lib/tx-draft/mutations";

const WALLET_ADDRESS = realTestAddresses.address1;
const RECIPIENT = realTestAddresses.address2;
const SCRIPT_CBOR = "8201828200581c00";
const FEE = "180000";

function utxo(index: number, lovelace: string): UTxO {
  return {
    input: { txHash: "a".repeat(64), outputIndex: index },
    output: {
      address: WALLET_ADDRESS,
      amount: [{ unit: "lovelace", quantity: lovelace }],
    },
  } as UTxO;
}

function sendDraft(lovelace: string): TxDraft {
  const draft = addOutput(createDraft("d1"), {
    id: "out-1",
    address: RECIPIENT,
    assets: [{ unit: "lovelace", quantity: lovelace }],
  }).draft;
  return setUtxoSelection(draft, {
    mode: "manual",
    utxos: [utxo(0, "5000000")],
  });
}

/** A syntactically valid unsigned tx so the hash can be resolved. */
function minimalTxHex(): string {
  const inputs = csl.TransactionInputs.new();
  inputs.add(
    csl.TransactionInput.new(
      csl.TransactionHash.from_bytes(Buffer.from("00".repeat(32), "hex")),
      0,
    ),
  );
  const outputs = csl.TransactionOutputs.new();
  outputs.add(
    csl.TransactionOutput.new(
      csl.Address.from_bech32(RECIPIENT),
      csl.Value.new(csl.BigNum.from_str("1000000")),
    ),
  );
  const body = csl.TransactionBody.new(
    inputs,
    outputs,
    csl.BigNum.from_str(FEE),
    undefined,
  );
  return csl.Transaction.new(
    body,
    csl.TransactionWitnessSet.new(),
    undefined,
  ).to_hex();
}

/**
 * Stands in for `MeshTxBuilder.complete()` without a provider: flushes the
 * queued input/output into the body, then does what `complete()` leaves
 * behind — a fee and a trailing change output.
 */
function fakeComplete(txHex: string) {
  const calls: string[] = [];
  const complete = async (txBuilder: MeshTxBuilder) => {
    calls.push("complete");
    (
      txBuilder as unknown as { queueAllLastItem: () => void }
    ).queueAllLastItem();
    txBuilder.meshTxBuilderBody.fee = FEE;
    txBuilder.meshTxBuilderBody.outputs.push({
      address: txBuilder.meshTxBuilderBody.changeAddress,
      amount: [{ unit: "lovelace", quantity: "2820000" }],
    });
    return txHex;
  };
  return { complete, calls };
}

describe("buildDraftTx", () => {
  test("completion cannot drop an imported required signer", async () => {
    const draft = {
      ...sendDraft("2000000"),
      requiredSigners: ["d".repeat(56)],
    };
    const { complete } = fakeComplete(minimalTxHex());
    await expect(
      buildDraftTx(
        new MeshTxBuilder({}),
        draft,
        {
          inputs: { kind: "pubkey" },
          walletAddress: WALLET_ADDRESS,
          availableUtxos: [],
        },
        { complete },
      ),
    ).rejects.toThrow(/dropped a required signer/);
  });
  test("applies the draft and metadata, completes once, and reports the result", async () => {
    const txHex = minimalTxHex();
    const { complete, calls } = fakeComplete(txHex);
    const txBuilder = new MeshTxBuilder({});

    const result = await buildDraftTx(
      txBuilder,
      sendDraft("2000000"),
      {
        inputs: { kind: "script", scriptCbor: SCRIPT_CBOR },
        walletAddress: WALLET_ADDRESS,
        availableUtxos: [],
      },
      { metadataMessage: "Test build", complete },
    );

    expect(calls).toEqual(["complete"]);
    expect(result.unsignedTx).toBe(txHex);
    expect(result.txHash).toBe(resolveTxHash(txHex).toLowerCase());
    expect(result.fee).toBe(FEE);
    expect(result.sizeBytes).toBe(txHex.length / 2);
    expect(result.inputCount).toBe(1);
    // payment + change appended by complete()
    expect(result.outputCount).toBe(2);
    expect(result.body.changeAddress).toBe(WALLET_ADDRESS);
    expect(result.body.outputs[0]).toMatchObject({ address: RECIPIENT });
    // Mesh normalizes metadatum objects into Maps.
    expect(result.body.metadata.get(674n)).toEqual(
      new Map([["msg", "Test build"]]),
    );
  });

  test("omits metadata when there is no message", async () => {
    const { complete } = fakeComplete(minimalTxHex());
    const txBuilder = new MeshTxBuilder({});

    const result = await buildDraftTx(
      txBuilder,
      sendDraft("2000000"),
      {
        inputs: { kind: "script", scriptCbor: SCRIPT_CBOR },
        walletAddress: WALLET_ADDRESS,
        availableUtxos: [],
      },
      { complete },
    );

    expect(result.body.metadata.size).toBe(0);
  });

  test("an empty draft throws before complete() is called", async () => {
    const { complete, calls } = fakeComplete(minimalTxHex());

    await expect(
      buildDraftTx(
        new MeshTxBuilder({}),
        createDraft("d1"),
        {
          inputs: { kind: "script", scriptCbor: SCRIPT_CBOR },
          walletAddress: WALLET_ADDRESS,
          availableUtxos: [],
        },
        { complete },
      ),
    ).rejects.toThrow("no outputs");
    expect(calls).toEqual([]);
  });

  test("complete() failures propagate to the caller", async () => {
    await expect(
      buildDraftTx(
        new MeshTxBuilder({}),
        sendDraft("2000000"),
        {
          inputs: { kind: "script", scriptCbor: SCRIPT_CBOR },
          walletAddress: WALLET_ADDRESS,
          availableUtxos: [],
        },
        {
          complete: async () => {
            throw new Error("UTxO Balance Insufficient");
          },
        },
      ),
    ).rejects.toThrow("UTxO Balance Insufficient");
  });
});

const models = [
  DEFAULT_V1_COST_MODEL_LIST,
  DEFAULT_V2_COST_MODEL_LIST,
  DEFAULT_V3_COST_MODEL_LIST,
];
const freshModels = {
  PlutusV1: models[0],
  PlutusV2: models[1],
  PlutusV3: models[2],
};
const plutusCbor = "49480100002221200101";
const owner = csl.PrivateKey.generate_ed25519().to_public().hash();
const keyAddress = csl.EnterpriseAddress.new(
  0,
  csl.Credential.from_keyhash(owner),
)
  .to_address()
  .to_bech32();

/** Real SDK completion/CBOR, deterministic chain and evaluator fixtures (not on-chain acceptance). */
function plutusFixture(
  version: DraftScriptInput["script"]["version"] = "V2",
  provided = false,
  nativeFunding = false,
) {
  const scriptAddress = resolvePlutusScriptAddress(
    { code: plutusCbor, version },
    0,
  );
  const native = csl.NativeScript.new_script_pubkey(
    csl.ScriptPubkey.new(owner),
  );
  const fundingAddress = nativeFunding
    ? csl.EnterpriseAddress.new(
        0,
        csl.Credential.from_scripthash(native.hash()),
      )
        .to_address()
        .to_bech32()
    : keyAddress;
  const scripts: UTxO[] = ["f", "a"].map((hash, i) => ({
    input: { txHash: hash.repeat(64), outputIndex: i },
    output: {
      address: scriptAddress,
      amount: [{ unit: "lovelace", quantity: "3000000" }],
      ...(provided
        ? { dataHash: resolveDataHash("01", "CBOR") }
        : { plutusData: "01" }),
    },
  }));
  const collateral: UTxO = {
    input: { txHash: "c".repeat(64), outputIndex: 0 },
    output: {
      address: keyAddress,
      amount: [{ unit: "lovelace", quantity: "2000000" }],
    },
  };
  const funding: UTxO = {
    input: { txHash: "b".repeat(64), outputIndex: 0 },
    output: {
      address: fundingAddress,
      amount: [{ unit: "lovelace", quantity: "12000000" }],
    },
  };
  const live = [...scripts, collateral, funding];
  const provider = {
    fetchUTxOs: jest.fn(async (hash: string) =>
      live.filter((u) => u.input.txHash === hash),
    ),
    fetchAddressUTxOs: jest.fn(async (address: string) =>
      live.filter((u) => u.output.address === address),
    ),
    fetchProtocolParameters: jest
      .fn()
      .mockResolvedValue({ ...DEFAULT_PROTOCOL_PARAMETERS }),
  };
  const wallet = {
    getNetworkId: jest.fn().mockResolvedValue(0),
    getUtxos: jest.fn().mockResolvedValue([collateral]),
    signTx: jest.fn(),
    submitTx: jest.fn(),
  };
  const evaluate: IEvaluator["evaluateTx"] = async (hex) => {
    const redeemers = csl.Transaction.from_hex(hex).witness_set().redeemers()!;
    return Array.from({ length: redeemers.len() }, (_, i) => {
      const redeemer = redeemers.get(i);
      const n = Number(redeemer.data().as_integer()!.to_str());
      return {
        tag: "SPEND" as const,
        index: Number(redeemer.index().to_str()),
        budget: { mem: n * 1000, steps: n * 10000 },
      };
    });
  };
  const evaluator = { evaluateTx: jest.fn(evaluate) };
  const builder = new MeshTxBuilder({
    evaluator,
    fetcher: provider as unknown as IFetcher,
  })
    .setNetwork("preprod")
    .setCostModels(models);
  const draft: TxDraft = {
    ...createDraft(),
    source: nativeFunding ? { kind: "multisig" } : { kind: "connected" },
    outputs: [
      {
        id: "payment",
        address: keyAddress,
        assets: [{ unit: "lovelace", quantity: "8000000" }],
        ...(!provided
          ? { inlineDatum: { format: "CBOR" as const, text: "02" } }
          : {}),
      },
    ],
    scriptInputs: scripts.map((u, i) => ({
      id: `script-${i}`,
      utxoRef: u.input,
      script: { cbor: plutusCbor, version },
      datumSource: provided
        ? { kind: "provided", data: { format: "CBOR", text: "01" } }
        : { kind: "inline" },
      redeemer: { format: "CBOR", text: `0${i + 1}` },
    })),
    collateral: { utxoRef: collateral.input },
  };
  const context: ApplyDraftContext = {
    inputs: nativeFunding
      ? { kind: "script", scriptCbor: native.to_hex() }
      : { kind: "pubkey" },
    walletAddress: fundingAddress,
    availableUtxos: [funding, ...scripts, collateral],
  };
  const complete = jest.fn((b: MeshTxBuilder) =>
    completeTxWithFreshCostModels(b, 0),
  );
  const options: BuildDraftTxOptions = {
    complete,
    metadataMessage: "evaluated fixture",
    plutus: { wallet, network: 0, provider },
  };
  return {
    builder,
    draft,
    scripts,
    live,
    collateral,
    funding,
    provider,
    wallet,
    evaluator,
    evaluate,
    complete,
    context,
    options,
    build: () => buildDraftTx(builder, draft, context, options),
  };
}

describe("evaluated Plutus draft builds", () => {
  beforeEach(() => {
    // Node's structuredClone creates Maps outside Jest's VM realm; Mesh uses
    // instanceof Map for metadata. Rehome cloned containers for real SDK tests.
    const clone = global.structuredClone;
    const rehome = (value: any): any => {
      if (Object.prototype.toString.call(value) === "[object Map]")
        return new Map(
          Array.from(value.entries(), ([k, v]: any) => [rehome(k), rehome(v)]),
        );
      if (Array.isArray(value)) return value.map(rehome);
      if (value && Object.prototype.toString.call(value) === "[object Object]")
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, rehome(v)]),
        );
      return value;
    };
    jest
      .spyOn(global, "structuredClone")
      .mockImplementation((value) => rehome(clone(value)));
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ cost_models_raw: freshModels }),
    } as Response);
  });
  afterEach(() => jest.restoreAllMocks());

  test.each([
    ["V1", true],
    ["V2", true],
    ["V2", false],
    ["V3", true],
    ["V3", false],
  ] as const)(
    "%s provided=%s survives propose/load/edit/rebuild without old signatures or budgets",
    async (version, provided) => {
      const f = plutusFixture(version, provided, true);
      f.draft.requiredSigners = ["d".repeat(56)];
      // Intentional self-output and distinct outputs at the same address.
      f.draft.outputs[0]!.assets[0]!.quantity = "4000000";
      f.draft.outputs.push({
        ...f.draft.outputs[0]!,
        id: "second",
        inlineDatum: provided ? undefined : { format: "CBOR", text: "03" },
      });
      f.draft.outputs.push({
        id: "self",
        address: f.context.walletAddress,
        assets: [{ unit: "lovelace", quantity: "2000000" }],
        inlineDatum: provided ? undefined : { format: "CBOR", text: "04" },
      });
      const built = await f.build();
      const signer = csl.PrivateKey.generate_ed25519();
      const witnesses = csl.TransactionWitnessSet.new();
      const vkeys = csl.Vkeywitnesses.new();
      vkeys.add(
        csl.Vkeywitness.new(
          csl.Vkey.new(signer.to_public()),
          signer.sign(Buffer.from(built.txHash, "hex")),
        ),
      );
      witnesses.set_vkeys(vkeys);
      const signed = mergeSignerWitnesses(built.unsignedTx, witnesses.to_hex());
      expect(resolveTxHash(signed.txHex)).toBe(built.txHash);
      const unsigned = csl.Transaction.from_hex(built.unsignedTx);
      const merged = csl.Transaction.from_hex(signed.txHex);
      expect(merged.witness_set().plutus_scripts()!.to_hex()).toBe(
        unsigned.witness_set().plutus_scripts()!.to_hex(),
      );
      expect(merged.witness_set().plutus_data()?.to_hex()).toBe(
        unsigned.witness_set().plutus_data()?.to_hex(),
      );
      expect(merged.witness_set().redeemers()!.to_hex()).toBe(
        unsigned.witness_set().redeemers()!.to_hex(),
      );
      expect(merged.auxiliary_data()?.to_hex()).toBe(
        unsigned.auxiliary_data()?.to_hex(),
      );
      const pending = {
        txJson: JSON.stringify({
          ...built.body,
          builderOutputs: createOutputProvenance(f.draft, built.body.outputs),
        }),
        txCbor: signed.txHex,
        signedAddresses: [keyAddress],
      };
      const stored = JSON.parse(pending.txJson);
      // Stored input order need not match either draft or ledger order.
      stored.inputs.reverse();
      const { draft, inputRefs, warnings } = txJsonToDraft(stored, {
        walletAddress: f.context.walletAddress,
      });
      expect(warnings).toEqual([]);
      expect(draft.outputs.map((output) => output.id)).toEqual([
        "payment",
        "second",
        "self",
      ]);
      expect(draft.outputs.map((output) => output.inlineDatum?.text)).toEqual(
        provided ? [undefined, undefined, undefined] : ["02", "03", "04"],
      );
      expect(inputRefs).toEqual([
        { txHash: f.funding.input.txHash, txIndex: 0 },
      ]);
      expect(draft.collateral).toEqual(f.draft.collateral);
      expect(draft.requiredSigners).toEqual(
        expect.arrayContaining([owner.to_hex(), "d".repeat(56)]),
      );
      expect(invalidateDraftContext(draft).requiredSigners).toEqual(
        draft.requiredSigners,
      );
      for (const input of draft.scriptInputs) {
        const original = f.draft.scriptInputs.find(
          (entry) => entry.utxoRef.txHash === input.utxoRef.txHash,
        )!;
        expect(input).toMatchObject({
          script: original.script,
          datumSource: original.datumSource,
          redeemer: original.redeemer,
        });
        expect(input).not.toHaveProperty("exUnits");
      }
      draft.scriptInputs.find(
        (input) => input.utxoRef.txHash === "f".repeat(64),
      )!.redeemer.text = "03";
      draft.outputs[0]!.assets[0]!.quantity = "3500000";
      const again = await buildDraftTx(
        plutusFixture(version, provided, true).builder,
        draft,
        f.context,
        f.options,
      );
      expect(again.txHash).not.toBe(built.txHash);
      const tx = csl.Transaction.from_hex(again.unsignedTx);
      expect(tx.witness_set().vkeys()?.len() ?? 0).toBe(0);
      expect(tx.witness_set().plutus_scripts()!.len()).toBe(1);
      expect(tx.body().required_signers()!.len()).toBe(2);
      expect(tx.body().script_data_hash()).toBeDefined();
      const datums = tx.witness_set().plutus_data();
      expect([
        ...new Set(
          Array.from({ length: datums?.len() ?? 0 }, (_, i) =>
            datums!.get(i).to_hex(),
          ),
        ),
      ]).toEqual(provided ? ["01"] : []);
      const redeemers = tx.witness_set().redeemers()!;
      for (let i = 0; i < redeemers.len(); i++) {
        const redeemer = redeemers.get(i);
        const ref = tx.body().inputs().get(Number(redeemer.index().to_str()));
        const input = draft.scriptInputs.find(
          (entry) => entry.utxoRef.txHash === ref.transaction_id().to_hex(),
        )!;
        expect(redeemer.data().to_hex()).toBe(input.redeemer.text);
        expect(redeemer.ex_units().mem().to_str()).toBe(
          String(Number(input.redeemer.text) * 1000),
        );
      }
      expect(f.wallet.signTx).not.toHaveBeenCalled();
      expect(f.wallet.submitTx).not.toHaveBeenCalled();
    },
  );

  test("legacy Plutus JSON retains all outputs and malformed provenance cannot discard them", async () => {
    const f = plutusFixture();
    const built = await f.build();
    const stored = JSON.parse(JSON.stringify(built.body));
    for (const builderOutputs of [
      undefined,
      { version: 2, outputs: [] },
      { version: 1, outputs: [{ id: "payment", fingerprint: "wrong" }] },
    ]) {
      const loaded = txJsonToDraft(
        { ...stored, builderOutputs },
        { walletAddress: keyAddress },
      );
      expect(loaded.draft.outputs).toHaveLength(stored.outputs.length);
      expect(loaded.warnings).toEqual(["change-not-detected"]);
      expect(loaded.draft.scriptInputs).toHaveLength(2);
    }
  });

  test("unknown, incomplete and mismatched Plutus shapes stay incompatible", async () => {
    const f = plutusFixture();
    const built = await f.build();
    const modifications: ((body: any) => void)[] = [
      (body) => {
        body.inputs.find(
          (i: any) => i.type === "Script",
        ).scriptTxIn.scriptSource.type = "Inline";
      },
      (body) => {
        delete body.inputs.find((i: any) => i.type === "Script").scriptTxIn
          .datumSource;
      },
      (body) => {
        body.inputs.find(
          (i: any) => i.type === "Script",
        ).scriptTxIn.datumSource.txIndex = 42;
      },
      (body) => {
        body.inputs.find(
          (i: any) => i.type === "Script",
        ).scriptTxIn.redeemer.data.content = "invalid";
      },
      (body) => {
        body.inputs.find((i: any) => i.type === "Script").scriptTxIn.extra =
          "unsupported";
      },
      (body) => {
        body.inputs.find(
          (i: any) => i.type === "Script",
        ).scriptTxIn.scriptSource.script.version = "V1";
      },
      (body) => {
        body.collaterals = [];
      },
      (body) => {
        body.collaterals.push(body.collaterals[0]);
      },
      (body) => {
        body.collaterals[0].txIn = body.inputs[0].txIn;
      },
      (body) => {
        body.requiredSignatures.push({ scriptHash: "d".repeat(56) });
      },
    ];
    for (const modify of modifications) {
      const stored = JSON.parse(JSON.stringify(built.body));
      modify(stored);
      expect(isDraftCompatible(stored).compatible).toBe(false);
      expect(() =>
        txJsonToDraft(stored, { walletAddress: keyAddress }),
      ).toThrow();
    }
  });

  test.each([
    "spent-script",
    "spent-collateral",
    "changed-account",
    "insufficient-collateral",
  ])("loaded transactions recheck %s before rebuilding", async (failure) => {
    const f = plutusFixture();
    const built = await f.build();
    const { draft } = txJsonToDraft(
      JSON.parse(
        JSON.stringify({
          ...built.body,
          builderOutputs: createOutputProvenance(f.draft, built.body.outputs),
        }),
      ),
      { walletAddress: keyAddress },
    );
    if (failure === "spent-script")
      f.live.splice(f.live.indexOf(f.scripts[0]!), 1);
    if (failure === "spent-collateral")
      f.live.splice(f.live.indexOf(f.collateral), 1);
    if (failure === "changed-account") f.wallet.getUtxos.mockResolvedValue([]);
    if (failure === "insufficient-collateral")
      f.collateral.output.amount[0]!.quantity = "1";
    await expect(
      buildDraftTx(plutusFixture().builder, draft, f.context, f.options),
    ).rejects.toThrow();
    expect(f.wallet.signTx).not.toHaveBeenCalled();
  });

  test.each([false, true])(
    "serializes mixed funding (native=%s), ledger-indexed redeemers, datums, collateral and owner without signing",
    async (native) => {
      const f = plutusFixture("V2", false, native);
      const result = await f.build();
      const tx = csl.Transaction.from_hex(result.unsignedTx);
      const body = tx.body();
      const ws = tx.witness_set();
      expect(body.inputs().len()).toBe(3);
      const redeemers = ws.redeemers()!;
      expect(redeemers.len()).toBe(2);
      for (let i = 0; i < redeemers.len(); i++) {
        const r = redeemers.get(i);
        const input = body.inputs().get(Number(r.index().to_str()));
        const original = f.draft.scriptInputs.find(
          (s) => s.utxoRef.txHash === input.transaction_id().to_hex(),
        )!;
        expect(r.data().to_hex()).toBe(original.redeemer.text);
        expect(r.ex_units().mem().to_str()).toBe(
          String(Number(original.redeemer.text) * 1000),
        );
      }
      expect(redeemers.get(0).data().to_hex()).toBe("02"); // draft order was f then a; ledger order is a, b, f
      expect(body.outputs().get(0).plutus_data()!.to_hex()).toBe("02");
      expect(ws.plutus_scripts()!.len()).toBe(1);
      expect(ws.native_scripts()?.len() ?? 0).toBe(native ? 1 : 0);
      expect(ws.vkeys()?.len() ?? 0).toBe(0);
      expect(body.collateral()!.get(0).transaction_id().to_hex()).toBe(
        f.collateral.input.txHash,
      );
      expect(body.required_signers()!.get(0).to_hex()).toBe(owner.to_hex());
      expect(body.collateral_return()).toBeUndefined();
      expect(body.script_data_hash()).toBeDefined();
      expect(result.unsignedTx).toBe(
        refreshScriptDataHash(result.unsignedTx, freshModels, result.body),
      );
      expect(f.evaluator.evaluateTx.mock.calls.at(-1)![0]).toBe(
        result.unsignedTx,
      );
      expect(f.evaluator.evaluateTx.mock.calls.length).toBeGreaterThan(1);
      expect(result.fee).toBe(body.fee().to_str());
      expect(result.plutusReview!.collateral.maximumExposureLovelace).toBe(
        "2000000",
      );
      expect(result.plutusReview!.budgets).toHaveLength(2);
      expect(f.wallet.signTx).not.toHaveBeenCalled();
      expect(f.wallet.submitTx).not.toHaveBeenCalled();
      expect(f.complete).toHaveBeenCalledTimes(1);
    },
  );

  test.each(["V1", "V2", "V3"] as const)(
    "%s supplied hash-matched datums are encoded as witnesses",
    async (version) => {
      const f = plutusFixture(version, true);
      const tx = csl.Transaction.from_hex((await f.build()).unsignedTx);
      expect(tx.witness_set().plutus_data()!.get(0).to_hex()).toBe("01");
      expect(
        tx.witness_set().plutus_scripts()!.get(0).language_version().kind(),
      ).toBe(Number(version.slice(1)) - 1);
    },
  );

  test("V3 inline data and script-only funding need no ordinary funding input", async () => {
    const f = plutusFixture("V3");
    f.scripts.forEach((u) => (u.output.amount[0]!.quantity = "10000000"));
    const result = await f.build();
    expect(result.inputCount).toBe(2);
  });

  test("V1 rejects inline data before completion", async () => {
    const f = plutusFixture("V1");
    await expect(f.build()).rejects.toThrow(/V1/);
    expect(f.complete).not.toHaveBeenCalled();
  });

  test("an unavailable evaluator and headless Plutus intent fail before completion", async () => {
    const f = plutusFixture();
    f.builder.evaluator = undefined;
    await expect(f.build()).rejects.toThrow(/evaluator/);
    f.options.plutus = undefined;
    await expect(f.build()).rejects.toThrow(
      /Headless Plutus encoding is not enabled/,
    );
    expect(f.complete).not.toHaveBeenCalled();
  });

  test.each(["empty", "partial", "duplicate", "negative", "unsafe", "reject"])(
    "blocks %s evaluator responses during balancing",
    async (mode) => {
      const f = plutusFixture();
      f.evaluator.evaluateTx.mockImplementation(async (hex) => {
        const actions = await f.evaluate(hex);
        if (mode === "reject") throw new Error("Script evaluation rejected");
        if (mode === "empty") return [];
        if (mode === "partial") return actions.slice(0, 1);
        if (mode === "duplicate") return [actions[0]!, actions[0]!];
        actions[0]!.budget.mem =
          mode === "negative" ? -1 : Number.MAX_SAFE_INTEGER + 1;
        return actions;
      });
      await expect(f.build()).rejects.toThrow(/valuation|budgets/);
    },
  );

  test("rechecks exact final bytes and blocks underestimated budgets", async () => {
    const f = plutusFixture();
    f.options.complete = async (builder) => {
      const hex = await f.complete(builder);
      f.evaluator.evaluateTx.mockImplementation(async (tx) =>
        (await f.evaluate(tx)).map((a) => ({
          ...a,
          budget: { ...a.budget, mem: a.budget.mem + 1 },
        })),
      );
      return hex;
    };
    await expect(f.build()).rejects.toThrow(/larger execution budget/);
  });

  test.each(["chain", "spent", "parameters", "cost models"])(
    "blocks %s failure without producing a result",
    async (mode) => {
      const f = plutusFixture();
      if (mode === "chain")
        f.provider.fetchUTxOs.mockRejectedValue(
          new Error("provider unavailable"),
        );
      if (mode === "spent")
        f.provider.fetchAddressUTxOs.mockResolvedValue([
          f.collateral,
          f.funding,
        ]);
      if (mode === "parameters")
        f.provider.fetchProtocolParameters.mockRejectedValue(
          new Error("parameters unavailable"),
        );
      if (mode === "cost models")
        jest
          .mocked(fetch)
          .mockRejectedValue(new Error("cost models unavailable"));
      await expect(f.build()).rejects.toThrow(
        /unavailable|spent|verify this UTxO/,
      );
    },
  );

  test.each(["size", "memory", "steps", "collateral", "fee"])(
    "enforces final %s limits",
    async (limit) => {
      const f = plutusFixture();
      // Limits change between preparation and final review; inspect the emitted tx.
      f.provider.fetchProtocolParameters
        .mockResolvedValueOnce({ ...DEFAULT_PROTOCOL_PARAMETERS })
        .mockResolvedValue({
          ...DEFAULT_PROTOCOL_PARAMETERS,
          ...(limit === "size"
            ? { maxTxSize: 1 }
            : limit === "memory"
              ? { maxTxExMem: "1" }
              : limit === "steps"
                ? { maxTxExSteps: "1" }
                : limit === "fee"
                  ? { minFeeA: 100000 }
                  : { collateralPercent: 100000 }),
        });
      await expect(f.build()).rejects.toThrow(
        /exceeds|Insufficient collateral|fee is insufficient/,
      );
    },
  );

  test.each(["resolution", "completion", "evaluation"])(
    "rejects a stale %s result",
    async (stage) => {
      const f = plutusFixture();
      let current = true;
      f.options.isCurrent = () => current;
      if (stage === "resolution")
        f.provider.fetchUTxOs.mockImplementation(async () => {
          current = false;
          return f.scripts;
        });
      else
        f.options.complete = async (builder) => {
          const hex = await f.complete(builder);
          if (stage === "completion") current = false;
          else
            f.evaluator.evaluateTx.mockImplementation(async (tx) => {
              current = false;
              return f.evaluate(tx);
            });
          return hex;
        };
      await expect(f.build()).rejects.toThrow(/superseded/);
    },
  );

  test("fresh cost models correct the script-data hash before the final evaluation", async () => {
    const f = plutusFixture();
    const changedV2 = [...DEFAULT_V2_COST_MODEL_LIST];
    changedV2[0] = changedV2[0]! + 1;
    jest.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        cost_models_raw: { ...freshModels, PlutusV2: changedV2 },
      }),
    } as Response);
    const result = await f.build();
    const tx = csl.Transaction.from_hex(result.unsignedTx);
    const costs = csl.Costmdls.new();
    const model = csl.CostModel.new();
    changedV2.forEach((value, index) =>
      model.set(index, csl.Int.new_i32(value)),
    );
    costs.insert(csl.Language.new_plutus_v2(), model);
    const expected = csl.hash_script_data(
      tx.witness_set().redeemers()!,
      costs,
      tx.witness_set().plutus_data(),
    );
    expect(tx.body().script_data_hash()!.to_hex()).toBe(expected.to_hex());
    const oldHash = csl.Transaction.from_hex(
      refreshScriptDataHash(result.unsignedTx, freshModels, result.body),
    )
      .body()
      .script_data_hash()!
      .to_hex();
    expect(oldHash).not.toBe(expected.to_hex());
    expect(f.evaluator.evaluateTx.mock.calls.at(-1)![0]).toBe(
      result.unsignedTx,
    );
  });

  test("completion cannot silently skip evaluation and retain default budgets", async () => {
    const f = plutusFixture();
    f.options.complete = async (builder) => {
      builder.evaluator = undefined;
      return f.complete(builder);
    };
    await expect(f.build()).rejects.toThrow(/skipped script evaluation/);
    expect(f.builder.evaluator).toBe(f.evaluator);
  });

  test("a new build never reuses an earlier live resolution", async () => {
    const f = plutusFixture();
    await f.build();
    f.provider.fetchAddressUTxOs.mockResolvedValue([f.collateral, f.funding]);
    const next = new MeshTxBuilder({ evaluator: f.evaluator })
      .setNetwork("preprod")
      .setCostModels(models);
    await expect(
      buildDraftTx(next, f.draft, f.context, f.options),
    ).rejects.toThrow(/spent/);
    expect(f.complete).toHaveBeenCalledTimes(1);
  });
});
