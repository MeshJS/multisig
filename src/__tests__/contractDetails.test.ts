import { csl } from "@meshsdk/core-csl";
import { toScriptRef } from "@meshsdk/core-cst";
import type { UTxO } from "@meshsdk/core";
import {
  assessTransactionRisks,
  resolveTransactionRisks,
} from "@/lib/tx-risk/transaction";
import { reviewPendingTransaction } from "@/lib/tx-risk/pending-review";
import { reconstructPendingTransaction } from "@/lib/tx-draft/reconstruct-pending";
import { ALWAYS_TRUE_V2 } from "@/lib/tx-risk/classify";
import {
  address,
  collateral,
  contractReviewTransaction,
  ctx,
  funding,
  HUGE_QUANTITY,
  native,
  output,
  scriptInput,
  transaction,
} from "./fixtures/tx-risk";

function change(
  hex: string,
  update: (
    body: csl.TransactionBody,
    witnesses: csl.TransactionWitnessSet,
  ) => void,
) {
  const tx = csl.Transaction.from_hex(hex);
  const body = tx.body();
  const witnesses = tx.witness_set();
  update(body, witnesses);
  return csl.Transaction.new(body, witnesses).to_hex();
}
function assess(
  hex = contractReviewTransaction(),
  utxos: UTxO[] = [scriptInput, collateral],
) {
  return assessTransactionRisks(hex, ctx, { utxos });
}
function refs(inputs: UTxO[]) {
  const list = csl.TransactionInputs.new();
  inputs.forEach(({ input }) =>
    list.add(
      csl.TransactionInput.new(
        csl.TransactionHash.from_hex(input.txHash),
        input.outputIndex,
      ),
    ),
  );
  return list;
}
function redeemer(
  index: number,
  value: string,
  memory = "10000",
  steps = "1000000",
) {
  return csl.Redeemer.new(
    csl.RedeemerTag.new_spend(),
    csl.BigNum.from_str(String(index)),
    csl.PlutusData.from_hex(value),
    csl.ExUnits.new(csl.BigNum.from_str(memory), csl.BigNum.from_str(steps)),
  );
}
function provider(utxos: UTxO[]) {
  return {
    fetchUTxOs: jest.fn(async () => utxos),
    fetchAddressUTxOs: jest.fn(async () => utxos),
  };
}
function without(hex: string, field: "scripts" | "datums" | "redeemers") {
  const tx = csl.Transaction.from_hex(hex);
  const old = tx.witness_set();
  const w = csl.TransactionWitnessSet.new();
  if (field !== "scripts" && old.plutus_scripts())
    w.set_plutus_scripts(old.plutus_scripts()!);
  if (field !== "datums" && old.plutus_data())
    w.set_plutus_data(old.plutus_data()!);
  if (field !== "redeemers" && old.redeemers())
    w.set_redeemers(old.redeemers()!);
  return csl.Transaction.new(tx.body(), w).to_hex();
}

describe("independent contract details from CBOR and chain facts", () => {
  test("retains exact arguments, script identity and recorded budgets without stored JSON", () => {
    const result = assess();
    expect(result.status).toBe("complete");
    expect(result.contractDetails!.spends).toEqual([
      expect.objectContaining({
        inputRef: scriptInput.input,
        scriptHash: ALWAYS_TRUE_V2.hash,
        language: "V2",
        scriptSource: "witness",
        datum: expect.objectContaining({
          kind: "inline",
          data: expect.objectContaining({ cbor: "01" }),
        }),
        redeemer: expect.objectContaining({ cbor: "d8799f02ff" }),
        budget: { memory: "10000", steps: "1000000" },
        errors: [],
      }),
    ]);
  });

  test("keeps duplicate-address output indices, inline/hash/no datum and collateral return distinct", () => {
    const first = output(address("key"), "2000000", false, true);
    const second = output(address("key"), "2000000");
    second.set_data_hash(csl.DataHash.from_hex("12".repeat(32)));
    const hex = transaction({
      outputs: [first, second, output(address("key"))],
      collateral: [collateral.input],
      returned: first,
      total: "0",
    });
    const result = assess(hex, [funding, collateral]);
    expect(result.status).toBe("complete");
    expect(
      result.contractDetails!.outputs.map((o) => [
        o.outputIndex,
        o.datum.kind,
        o.outputRole,
      ]),
    ).toEqual([
      [0, "inline", undefined],
      [1, "hash", undefined],
      [2, "none", undefined],
      [3, "inline", "collateral-return"],
    ]);
    // The read-only model covers a transaction the editor cannot reproduce.
    expect(
      reconstructPendingTransaction({ txCbor: hex, txJson: "{}" }, ctx, [
        funding,
        collateral,
      ]).compatible,
    ).toBe(false);
  });

  test.each(["datum", "redeemer"] as const)(
    "changing only %s changes independent review while payments stay equal",
    (field) => {
      const first = assess();
      const next = assess(
        contractReviewTransaction(
          field === "datum" ? "d8799f03ff" : undefined,
          field === "redeemer" ? "d8799f04ff" : undefined,
        ),
      );
      expect(next.outputs).toEqual(first.outputs);
      expect(next.contractDetails).not.toEqual(first.contractDetails);
    },
  );

  test("maps redeemers by ledger hash/index order, not body insertion or provider order", () => {
    const other: UTxO = {
      ...scriptInput,
      input: { txHash: "01".repeat(32), outputIndex: 9 },
      output: { ...scriptInput.output, plutusData: "02" },
    };
    const base = csl.Transaction.from_hex(
      transaction({
        spending: [scriptInput.input, funding.input, other.input],
        collateral: [collateral.input],
      }),
    );
    const hex = change(
      csl.Transaction.new(
        base.body(),
        csl.Transaction.from_hex(contractReviewTransaction()).witness_set(),
      ).to_hex(),
      (_body, witnesses) => {
        const list = csl.Redeemers.new();
        list.add(redeemer(2, "04"));
        list.add(redeemer(0, "03"));
        witnesses.set_redeemers(list);
      },
    );
    const result = assess(hex, [scriptInput, other, funding, collateral]);
    expect(result.status).toBe("complete");
    expect(
      result.contractDetails!.spends.map((s) => [
        s.inputRef,
        s.redeemer!.cbor,
        s.datum!.kind === "inline" && s.datum!.data.cbor,
      ]),
    ).toEqual([
      [other.input, "03", "02"],
      [scriptInput.input, "04", "01"],
    ]);
  });

  test("preserves large datum/redeemer integers and budgets without Number rounding", () => {
    const big = csl.PlutusData.new_integer(csl.BigInt.from_str(HUGE_QUANTITY));
    const hex = change(
      contractReviewTransaction(big.to_hex()),
      (_body, witnesses) => {
        const list = csl.Redeemers.new();
        list.add(redeemer(0, big.to_hex(), HUGE_QUANTITY, HUGE_QUANTITY));
        witnesses.set_redeemers(list);
      },
    );
    const details = assess(hex).contractDetails!;
    const datum = details.outputs[0]!.datum;
    expect(datum.kind === "inline" && datum.data.json).toContain(HUGE_QUANTITY);
    expect(details.spends[0]!.redeemer!.json).toContain(HUGE_QUANTITY);
    expect(details.spends[0]!.budget).toEqual({
      memory: HUGE_QUANTITY,
      steps: HUGE_QUANTITY,
    });
  });

  test.each(["V1", "V2", "V3"] as const)(
    "resolves %s hash datum from witnesses, never a fetched label",
    (version) => {
      // Serialization coverage only: relabelled bytes do not establish execution support.
      const script = csl.PlutusScript.from_hex_with_version(
        ALWAYS_TRUE_V2.cbor,
        version === "V1"
          ? csl.Language.new_plutus_v1()
          : version === "V2"
            ? csl.Language.new_plutus_v2()
            : csl.Language.new_plutus_v3(),
      );
      const datum = csl.PlutusData.from_hex("d8799f01ff");
      const input: UTxO = {
        ...scriptInput,
        output: {
          ...scriptInput.output,
          plutusData: undefined,
          dataHash: csl.hash_plutus_data(datum).to_hex(),
          address: csl.EnterpriseAddress.new(
            0,
            csl.Credential.from_scripthash(script.hash()),
          )
            .to_address()
            .to_bech32(),
        },
      };
      const hex = change(contractReviewTransaction(), (_body, witnesses) => {
        const scripts = csl.PlutusScripts.new();
        scripts.add(script);
        witnesses.set_plutus_scripts(scripts);
        const datums = csl.PlutusList.new();
        datums.add(datum);
        datums.add(datum);
        witnesses.set_plutus_data(datums);
      });
      expect(assess(hex, [input, collateral])).toMatchObject({
        status: "complete",
        contractDetails: {
          spends: [
            expect.objectContaining({
              language: version,
              datum: {
                kind: "hash",
                hash: input.output.dataHash,
                data: expect.objectContaining({ cbor: datum.to_hex() }),
              },
            }),
          ],
        },
      });
      const missing = without(hex, "datums");
      expect(assess(missing, [input, collateral]).status).toBe("incomplete");
    },
  );

  test("resolves a live reference script, refusing absent/spent/mismatched reference facts and recovering on retry", async () => {
    const reference: UTxO = {
      ...funding,
      input: { txHash: "ef".repeat(32), outputIndex: 2 },
      output: {
        ...funding.output,
        scriptRef: toScriptRef({
          code: ALWAYS_TRUE_V2.cbor,
          version: "V2",
        }).toCbor(),
      },
    };
    const hex = change(
      without(contractReviewTransaction(), "scripts"),
      (body) => {
        body.set_reference_inputs(refs([reference]));
      },
    );
    const p = provider([scriptInput, collateral, reference]);
    const reviewed = await resolveTransactionRisks(hex, ctx, p);
    expect(reviewed.status).toBe("complete");
    expect(reviewed.contractDetails!.spends[0]).toMatchObject({
      language: "V2",
      scriptSource: "reference-input",
      scriptRef: reference.input,
    });
    p.fetchAddressUTxOs.mockResolvedValue([scriptInput, collateral]);
    expect((await resolveTransactionRisks(hex, ctx, p)).status).toBe(
      "incomplete",
    );
    p.fetchAddressUTxOs.mockResolvedValue([
      scriptInput,
      collateral,
      {
        ...reference,
        output: {
          ...reference.output,
          scriptRef: toScriptRef({
            code: ALWAYS_TRUE_V2.cbor,
            version: "V1",
          }).toCbor(),
        },
      },
    ]);
    expect((await resolveTransactionRisks(hex, ctx, p)).status).toBe(
      "incomplete",
    );
    p.fetchAddressUTxOs.mockResolvedValue([scriptInput, collateral, reference]);
    expect((await resolveTransactionRisks(hex, ctx, p)).status).toBe(
      "complete",
    );
    for (const bad of [
      { ...reference.output, scriptRef: reference.output.scriptRef + "00" },
      { ...reference.output, scriptHash: "12".repeat(28) },
      { ...reference.output, address: address("key", 1) },
    ]) {
      p.fetchAddressUTxOs.mockResolvedValue([
        scriptInput,
        collateral,
        { ...reference, output: bad },
      ]);
      expect((await resolveTransactionRisks(hex, ctx, p)).status).toBe(
        "incomplete",
      );
    }
  });

  test.each([
    "script",
    "redeemer",
    "datum",
    "ambiguous-input",
    "provider",
    "index",
  ])(
    "missing or invalid %s blocks signing and preserves visible details",
    async (missing) => {
      let hex = contractReviewTransaction();
      let inputs = [scriptInput, collateral];
      if (missing === "script") hex = without(hex, "scripts");
      if (missing === "redeemer") hex = without(hex, "redeemers");
      if (missing === "index")
        hex = change(hex, (_b, w) => {
          const r = csl.Redeemers.new();
          r.add(redeemer(9, "01"));
          w.set_redeemers(r);
        });
      if (missing === "datum")
        inputs = [
          {
            ...scriptInput,
            output: { ...scriptInput.output, plutusData: "0100" },
          },
          collateral,
        ];
      if (missing === "ambiguous-input") inputs.push(scriptInput);
      const p = provider(inputs);
      if (missing === "provider")
        p.fetchAddressUTxOs.mockRejectedValue(new Error("unavailable"));
      const refresh = () => resolveTransactionRisks(hex, ctx, p);
      const result = await refresh();
      expect(result.status).toBe("incomplete");
      expect(result.contractDetails!.outputs[0]!.datum.kind).toBe("inline");
      const confirm = jest.fn(async () => ({
        accepted: true,
        acknowledged: true,
      }));
      expect(
        await reviewPendingTransaction(hex, {
          network: 0,
          isCurrent: () => true,
          refresh,
          confirm,
        }),
      ).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
    },
  );

  test("datum-only key payments require independent confirmation even with no risk findings", async () => {
    const hex = transaction({
      outputs: [output(address("key"), "5000000", false, true)],
    });
    const p = provider([funding]);
    const refresh = () => resolveTransactionRisks(hex, ctx, p);
    expect((await refresh()).findings).toEqual([]);
    const confirm = jest.fn(async () => ({
      accepted: true,
      acknowledged: false,
    }));
    const options = { network: 0, isCurrent: () => true, refresh, confirm };
    expect(await reviewPendingTransaction(hex, options)).toBe(true);
    expect(await reviewPendingTransaction(hex, options)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  test("optional labels and native staking/transfer scripts do not require Plutus details", () => {
    const hex = change(
      transaction({ outputs: [output(address("key"))] }),
      (body, w) => {
        const scripts = csl.NativeScripts.new();
        scripts.add(native);
        w.set_native_scripts(scripts);
        const keys = csl.Ed25519KeyHashes.new();
        keys.add(csl.Ed25519KeyHash.from_hex("ab".repeat(28)));
        body.set_required_signers(keys);
      },
    );
    const result = assess(hex, [funding]);
    expect(result.status).toBe("complete");
    expect(result.contractDetails!.spends).toEqual([]);
    expect(result.contractDetails!.requiredSigners).toEqual(["ab".repeat(28)]);
  });

  test("changed resolved datum during confirmation rejects old acceptance even when payments are identical", async () => {
    const hex = contractReviewTransaction();
    const p = provider([scriptInput, collateral]);
    await expect(
      reviewPendingTransaction(hex, {
        network: 0,
        isCurrent: () => true,
        refresh: () => resolveTransactionRisks(hex, ctx, p),
        confirm: async () => {
          p.fetchAddressUTxOs.mockResolvedValue([
            {
              ...scriptInput,
              output: { ...scriptInput.output, plutusData: "02" },
            },
            collateral,
          ]);
          return { accepted: true, acknowledged: true };
        },
      }),
    ).rejects.toThrow(/facts changed/);
  });
});
