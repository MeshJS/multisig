import {
  resolveDataHash,
  resolvePlutusScriptAddress,
  type UTxO,
} from "@meshsdk/core";
import type { DraftScriptInput } from "@/types/tx-draft";
import {
  resolveDraftScriptInputs,
  resolveScriptInput,
  type ScriptInputProvider,
} from "@/lib/tx-draft/resolve-script-inputs";
import {
  draftFundingTotals,
  ordinaryFundingUtxos,
  selectDraftFunding,
} from "@/lib/tx-draft/funding";
import { createDraft } from "@/lib/tx-draft/mutations";
import { validateDraft } from "@/lib/tx-draft/validate";
import { realTestAddresses } from "./testUtils";

const script = { code: "49480100002221200101", version: "V2" as const };
const address = resolvePlutusScriptAddress(script, 0);
const input: DraftScriptInput = {
  id: "script-1",
  utxoRef: { txHash: "a".repeat(64), outputIndex: 1 },
  script: { cbor: script.code, version: script.version },
  datumSource: { kind: "inline" },
  redeemer: { format: "CBOR", text: "d87980" },
};
const utxo: UTxO = {
  input: input.utxoRef,
  output: {
    address,
    amount: [{ unit: "lovelace", quantity: "9000000" }],
    plutusData: "01",
  },
};
function provider(live: UTxO[] = [utxo], historical: UTxO[] = [utxo]) {
  return {
    fetchUTxOs: jest.fn().mockResolvedValue(historical),
    fetchAddressUTxOs: jest.fn().mockResolvedValue(live),
  } satisfies ScriptInputProvider;
}
const draft = () => ({
  ...createDraft(),
  scriptInputs: [input],
  outputs: [
    {
      id: "out",
      address: realTestAddresses.address1,
      assets: [{ unit: "lovelace", quantity: "3000000" }],
    },
  ],
});

describe("chain-resolved Plutus input configuration", () => {
  test("uses exact live reference and chain values, not historical amounts", async () => {
    const p = provider(
      [utxo],
      [{ ...utxo, output: { ...utxo.output, amount: [] } }],
    );
    const result = await resolveScriptInput(input, 0, p);
    expect(result).toMatchObject({
      utxo,
      datumCbor: "01",
      redeemerCbor: "d87980",
      issues: [],
    });
    expect(p.fetchAddressUTxOs).toHaveBeenCalledWith(address);
  });
  test("a historical output is insufficient proof that an input is unspent", async () => {
    const result = await resolveScriptInput(input, 0, provider([]));
    expect(result.utxo).toBeUndefined();
    expect(result.issues[0]).toMatchObject({
      inputId: input.id,
      field: "utxoRef",
      code: "script-input-unavailable",
    });
  });
  test("does not substitute a different output index returned by a provider", async () => {
    const other = { ...utxo, input: { ...utxo.input, outputIndex: 0 } };
    expect(
      (await resolveScriptInput(input, 0, provider([other], [other]))).issues[0]
        ?.code,
    ).toBe("script-input-unavailable");
  });
  test("invalid references never query the provider", async () => {
    const p = provider();
    await resolveScriptInput(
      { ...input, utxoRef: { txHash: "bad", outputIndex: -1 } },
      0,
      p,
    );
    expect(p.fetchUTxOs).not.toHaveBeenCalled();
  });
  test.each(["V1", "V3", "V4"])(
    "wrong or unsupported language %s cannot match the script",
    async (version) => {
      const result = await resolveScriptInput(
        { ...input, script: { ...input.script, version: version as "V2" } },
        0,
        provider(),
      );
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "script-input-script-invalid" }),
        ]),
      );
    },
  );
  test("rejects a different script, key address, wrong network, and provider failure", async () => {
    expect(
      (
        await resolveScriptInput(
          { ...input, script: { ...input.script, cbor: "4101" } },
          0,
          provider(),
        )
      ).issues[0]?.code,
    ).toBe("script-input-script-invalid");
    const keyUtxo = {
      ...utxo,
      output: { ...utxo.output, address: realTestAddresses.address1 },
    };
    expect(
      (await resolveScriptInput(input, 0, provider([keyUtxo], [keyUtxo])))
        .issues[0]?.code,
    ).toBe("script-input-script-invalid");
    expect(
      (await resolveScriptInput(input, 1, provider())).issues[0]?.code,
    ).toBe("script-input-network");
    const p = provider();
    p.fetchAddressUTxOs.mockRejectedValue(new Error("offline"));
    expect((await resolveScriptInput(input, 0, p)).issues[0]?.code).toBe(
      "script-input-unavailable",
    );
  });
  test.each(["V1", "V2", "V3"] as const)(
    "%s supports supplied data only with the matching chain hash",
    async (version) => {
      const supplied: DraftScriptInput = {
        ...input,
        script: { ...input.script, version },
        datumSource: { kind: "provided", data: { format: "CBOR", text: "01" } },
      };
      const hashed: UTxO = {
        ...utxo,
        output: {
          address: resolvePlutusScriptAddress({ ...script, version }, 0),
          amount: utxo.output.amount,
          dataHash: resolveDataHash("01", "CBOR"),
        },
      };
      const p = provider([hashed], [hashed]);
      expect((await resolveScriptInput(supplied, 0, p)).issues).toEqual([]);
      const mismatched = {
        ...supplied,
        datumSource: {
          kind: "provided" as const,
          data: { format: "CBOR" as const, text: "02" },
        },
      };
      expect(
        (await resolveScriptInput(mismatched, 0, p)).issues[0]?.message,
      ).toMatch(/does not match/);
    },
  );
  test("missing, malformed, or incorrectly selected datum modes cannot invent a datum", async () => {
    for (const plutusData of [undefined, "ff"]) {
      const bad = { ...utxo, output: { ...utxo.output, plutusData } };
      expect(
        (await resolveScriptInput(input, 0, provider([bad], [bad]))).issues[0]
          ?.code,
      ).toBe("script-input-datum-invalid");
    }
    const supplied = {
      ...input,
      datumSource: {
        kind: "provided" as const,
        data: { format: "CBOR" as const, text: "01" },
      },
    };
    expect(
      (await resolveScriptInput(supplied, 0, provider())).issues[0]?.message,
    ).toMatch(/carries an inline datum/);
    const noDatum = {
      ...utxo,
      output: { address, amount: utxo.output.amount },
    };
    expect(
      (await resolveScriptInput(supplied, 0, provider([noDatum], [noDatum])))
        .issues[0]?.message,
    ).toMatch(/Datum-less/);
  });
  test("invalid redeemer edits invalidate a previously valid configuration", async () => {
    expect(
      (
        await resolveScriptInput(
          { ...input, redeemer: { format: "CBOR", text: "0" } },
          0,
          provider(),
        )
      ).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inputId: input.id, field: "redeemer" }),
      ]),
    );
  });
  test("fresh preparation catches inputs spent after the last successful lookup", async () => {
    const p = provider();
    expect((await resolveDraftScriptInputs(draft(), 0, p))[0]?.issues).toEqual(
      [],
    );
    p.fetchAddressUTxOs.mockResolvedValue([]);
    expect(
      (await resolveDraftScriptInputs(draft(), 0, p))[0]?.issues[0]?.code,
    ).toBe("script-input-unavailable");
  });
  test("a V1 hash-datum spend cannot coexist with an inline output datum", async () => {
    const v1: DraftScriptInput = {
      ...input,
      script: { ...input.script, version: "V1" },
      datumSource: { kind: "provided", data: { format: "CBOR", text: "01" } },
    };
    const hashed = {
      ...utxo,
      output: {
        address: resolvePlutusScriptAddress({ ...script, version: "V1" }, 0),
        amount: utxo.output.amount,
        dataHash: resolveDataHash("01", "CBOR"),
      },
    };
    const d = {
      ...draft(),
      scriptInputs: [v1],
      outputs: draft().outputs.map((output) => ({
        ...output,
        inlineDatum: { format: "CBOR" as const, text: "01" },
      })),
    };
    expect(
      (await resolveDraftScriptInputs(d, 0, provider([hashed], [hashed])))[0]
        ?.issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "script-input-datum-invalid",
          message: expect.stringContaining("anywhere"),
        }),
      ]),
    );
  });
  test("resolved duplicate inputs keep blocking errors attached to the duplicate", async () => {
    const results = await resolveDraftScriptInputs(
      { ...draft(), scriptInputs: [input, { ...input, id: "second" }] },
      0,
      provider(),
    );
    expect(results[1]?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "script-input-duplicate",
          inputId: "second",
        }),
      ]),
    );
  });
  test("discards late results from an old draft, source, account or network", async () => {
    let finish!: (value: UTxO[]) => void;
    const p = provider();
    p.fetchAddressUTxOs.mockImplementation(
      () =>
        new Promise<UTxO[]>((resolve) => {
          finish = resolve;
        }),
    );
    let current = true;
    const result = resolveDraftScriptInputs(draft(), 0, p, () => current);
    await Promise.resolve();
    current = false;
    finish([utxo]);
    await expect(result).rejects.toThrow(/superseded/);
  });
});

describe("separate Plutus and ordinary funding", () => {
  const keyUtxo: UTxO = {
    input: { txHash: "b".repeat(64), outputIndex: 0 },
    output: {
      address: realTestAddresses.address1,
      amount: [{ unit: "lovelace", quantity: "10000000" }],
    },
  };
  test("script ADA covers outputs and selection headroom without a second funding input", () => {
    expect(selectDraftFunding(draft(), [utxo, keyUtxo], [utxo])).toEqual([]);
    expect(
      draftFundingTotals(draft(), [utxo, keyUtxo], [utxo, utxo]).get(
        "lovelace",
      ),
    ).toBe(19000000n);
  });
  test("selects remaining funds and preserves exact manual choices", () => {
    const small = {
      ...utxo,
      output: {
        ...utxo.output,
        amount: [{ unit: "lovelace", quantity: "1000000" }],
      },
    };
    expect(selectDraftFunding(draft(), [utxo, keyUtxo], [small])).toEqual([
      keyUtxo,
    ]);
    expect(
      selectDraftFunding(
        { ...draft(), utxoSelection: { mode: "manual", utxos: [keyUtxo] } },
        [],
        [utxo],
      ),
    ).toEqual([keyUtxo]);
  });
  test("never selects collateral or explicit script inputs as ordinary funding", () => {
    const d = { ...draft(), collateral: { utxoRef: keyUtxo.input } };
    expect(ordinaryFundingUtxos(d, [utxo, keyUtxo])).toEqual([]);
    expect(selectDraftFunding(d, [utxo, keyUtxo], [])).toEqual([]);
    expect(() =>
      selectDraftFunding(
        { ...d, utxoSelection: { mode: "manual", utxos: [keyUtxo] } },
        [],
      ),
    ).toThrow(/overlap/);
  });
  test("duplicate refs and script/funding/collateral overlaps are blocking", () => {
    const d = {
      ...draft(),
      scriptInputs: [
        input,
        {
          ...input,
          id: "second",
          utxoRef: {
            ...input.utxoRef,
            txHash: input.utxoRef.txHash.toUpperCase(),
          },
        },
      ],
      collateral: { utxoRef: input.utxoRef },
      utxoSelection: { mode: "manual" as const, utxos: [utxo] },
    };
    expect(validateDraft(d, { network: 0 }).map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "script-input-duplicate",
        "script-input-overlap",
        "plutus-build-unsupported",
      ]),
    );
  });
  test("token value from the script reduces only the matching asset deficit", () => {
    const d = draft();
    d.outputs[0]!.assets.push({ unit: "token", quantity: "5" });
    const tokenScript = {
      ...utxo,
      output: {
        ...utxo.output,
        amount: [...utxo.output.amount, { unit: "token", quantity: "5" }],
      },
    };
    expect(
      selectDraftFunding(d, [keyUtxo, tokenScript], [tokenScript]),
    ).toEqual([]);
    expect(
      draftFundingTotals(d, [tokenScript], [tokenScript]).get("token"),
    ).toBe(5n);
  });
});
