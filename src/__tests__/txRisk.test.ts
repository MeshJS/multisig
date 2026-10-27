import {
  resolvePlutusScriptAddress,
  resolveScriptHash,
  type UTxO,
} from "@meshsdk/core";
import { csl } from "@meshsdk/core-csl";
import {
  ALWAYS_TRUE_V2,
  assertSuppliedScriptMatches,
  classifyPaymentAddress,
} from "@/lib/tx-risk/classify";
import {
  assessDraftOutputRisks,
  assessResolvedInput,
  riskFindingsToDraftIssues,
} from "@/lib/tx-risk/assessment";
import {
  assessTransactionRisks,
  resolveTransactionRisks,
} from "@/lib/tx-risk/transaction";
import {
  address,
  collateral,
  ctx,
  funding,
  HUGE_QUANTITY,
  native,
  output,
  scriptInput,
  TOKEN,
  transaction,
} from "./fixtures/tx-risk";

describe("payment script risk classification", () => {
  test("published fixture hash includes language version and matches the manual guide", () => {
    expect(resolveScriptHash(ALWAYS_TRUE_V2.cbor, "V2")).toBe(
      ALWAYS_TRUE_V2.hash,
    );
    expect(address("known")).toBe(
      "addr_test1wqag3rt979nep9g2wtdwu8mr4gz6m4kjdpp5zp705km8wys6t2kla",
    );
    expect(resolveScriptHash(ALWAYS_TRUE_V2.cbor, "V1")).not.toBe(
      ALWAYS_TRUE_V2.hash,
    );
  });

  test.each([0, 1])(
    "matches payment hash across enterprise/base and stake variants on network %i",
    (network) => {
      for (const base of [false, true])
        for (const scriptStake of [false, true]) {
          expect(
            classifyPaymentAddress(
              address("known", network, base, scriptStake),
              { network },
            ).kind,
          ).toBe("known-anyone-can-spend");
          expect(
            classifyPaymentAddress(address("key", network, base, scriptStake), {
              network,
            }).kind,
          ).toBe("key");
        }
    },
  );

  test("only a verified wallet native script is exempt, regardless of stake credential", () => {
    expect(
      classifyPaymentAddress(address("own", 0, true, true), ctx).kind,
    ).toBe("wallet-native-script");
    expect(classifyPaymentAddress(address("own"), { network: 0 }).kind).toBe(
      "unknown-script",
    );
    expect(() =>
      classifyPaymentAddress(address("unknown"), {
        network: 0,
        walletNativeScript: {
          address: address("unknown"),
          cbor: native.to_hex(),
        },
      }),
    ).toThrow();
  });

  test("known danger wins over a claimed wallet exemption", () => {
    expect(
      classifyPaymentAddress(address("known"), {
        network: 0,
        walletNativeScript: {
          address: address("known"),
          cbor: native.to_hex(),
        },
      }).kind,
    ).toBe("known-anyone-can-spend");
  });

  test("pointer payment addresses use the same classification", () => {
    const pointer = csl.PointerAddress.new(
      0,
      csl.Credential.from_scripthash(
        csl.ScriptHash.from_hex(ALWAYS_TRUE_V2.hash),
      ),
      csl.Pointer.new(1, 0, 0),
    )
      .to_address()
      .to_bech32();
    expect(classifyPaymentAddress(pointer, ctx).kind).toBe(
      "known-anyone-can-spend",
    );
  });

  test("modified script and language variants remain unknown, not safe", () => {
    for (const script of [
      { code: "49480100002221200100", version: "V2" as const },
      { code: ALWAYS_TRUE_V2.cbor, version: "V1" as const },
    ]) {
      expect(
        classifyPaymentAddress(resolvePlutusScriptAddress(script, 0), {
          network: 0,
        }).kind,
      ).toBe("unknown-script");
    }
    expect(() =>
      assertSuppliedScriptMatches(address("known"), {
        cbor: ALWAYS_TRUE_V2.cbor,
        version: "V1",
      }),
    ).toThrow();
    expect(() =>
      assertSuppliedScriptMatches(address("known"), {
        cbor: ALWAYS_TRUE_V2.cbor,
        version: "V2",
      }),
    ).not.toThrow();
  });

  test("rejects wrong-network, malformed and reward addresses without guessing", () => {
    const reward = csl.RewardAddress.new(
      0,
      csl.Credential.from_scripthash(
        csl.ScriptHash.from_hex(ALWAYS_TRUE_V2.hash),
      ),
    )
      .to_address()
      .to_bech32();
    for (const invalid of [
      address("known", 1),
      reward,
      address("known").slice(0, -1) + "x",
      "addr_test",
    ])
      expect(() => classifyPaymentAddress(invalid, { network: 0 })).toThrow();
  });
});

describe("draft output feedback", () => {
  const draft = () => ({
    outputs: [
      {
        id: "first",
        address: address("known"),
        assets: [
          { unit: "lovelace", quantity: "5000000" },
          { unit: TOKEN, quantity: HUGE_QUANTITY },
        ],
      },
      {
        id: "second",
        address: address("known"),
        assets: [{ unit: "lovelace", quantity: "3000000" }],
      },
    ],
  });

  test("funding without datum or Plutus inputs warns and preserves distinct output identities", () => {
    const result = assessDraftOutputRisks(draft(), ctx);
    expect(result).toMatchObject({
      status: "complete",
      scope: "draft-outputs",
      version: 1,
    });
    expect(
      result.findings.map((f) => [
        f.outputId,
        f.outputIndex,
        f.requiresAcknowledgment,
      ]),
    ).toEqual([
      ["first", 0, true],
      ["second", 1, true],
    ]);
    expect(result.findings[0]?.assets).toContainEqual({
      unit: TOKEN,
      quantity: HUGE_QUANTITY,
    });
    expect(riskFindingsToDraftIssues(result.findings)[1]).toMatchObject({
      level: "warning",
      code: "script-output-anyone-can-spend",
      outputId: "second",
    });
  });

  test("reorder and edit derive fresh warnings, and a key output with datum is not dangerous", () => {
    const changed = draft();
    changed.outputs.reverse();
    changed.outputs[0]!.address = address("key", 0, true, true);
    const result = assessDraftOutputRisks(
      {
        outputs: changed.outputs.map((o) => ({
          ...o,
          inlineDatum: { format: "CBOR", text: "01" },
        })),
      },
      ctx,
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      outputId: "first",
      outputIndex: 1,
    });
  });

  test("unknown rules are complete assessment, but malformed edits and forged wallet context are not", () => {
    const unknown = {
      outputs: [{ id: "unknown", address: address("unknown"), assets: [] }],
    };
    expect(assessDraftOutputRisks(unknown, ctx)).toMatchObject({
      status: "complete",
      findings: [
        { code: "script-output-rules-unknown", requiresAcknowledgment: false },
      ],
    });
    expect(
      assessDraftOutputRisks(
        { outputs: [{ ...draft().outputs[0]!, address: "" }] },
        ctx,
      ).status,
    ).toBe("incomplete");
    const result = assessDraftOutputRisks(draft(), {
      network: 0,
      walletNativeScript: { address: address("known"), cbor: native.to_hex() },
    });
    expect(result.status).toBe("incomplete");
    expect(result.findings).toHaveLength(2);
  });

  test.each(["-1", "1.5", "1e8", "NaN"])(
    "invalid quantity %s is not rounded or silently omitted",
    (quantity) => {
      const d = draft();
      d.outputs[0]!.assets[0]!.quantity = quantity;
      expect(assessDraftOutputRisks(d, ctx).errors[0]?.code).toBe(
        "output-unverified",
      );
    },
  );
});

describe("completed CBOR assessment", () => {
  test("inspects all final outputs and exact token units/quantities, independent of JSON or draft IDs", () => {
    const result = assessTransactionRisks(
      transaction({
        outputs: [
          output(address("known"), "6000000", true),
          output(address("known"), "3000000"),
          output(address("own")),
          output(address("key"), "1000000", false, true),
        ],
      }),
      ctx,
      { utxos: [funding] },
    );
    expect(result.status).toBe("complete");
    expect(result.outputs).toHaveLength(4);
    expect(result.findings).toHaveLength(2);
    expect(result.findings.map((f) => f.outputIndex)).toEqual([0, 1]);
    expect(result.findings[0]?.assets).toEqual(
      expect.arrayContaining([
        { unit: TOKEN, quantity: HUGE_QUANTITY },
        { unit: "44".repeat(28), quantity: "1" },
        { unit: "lovelace", quantity: "6000000" },
      ]),
    );
    expect(result.outputs[0]?.outputId).toBeUndefined();
    expect(result.txHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("malformed CBOR is incomplete, not an empty successful review", () => {
    for (const bytes of ["", "zz", "0", "a0", transaction() + "00"])
      expect(assessTransactionRisks(bytes, ctx)).toMatchObject({
        status: "incomplete",
        errors: expect.arrayContaining([
          expect.objectContaining({ code: "transaction-decode-failed" }),
        ]),
      });
  });

  test("missing/ambiguous chain facts retain output warnings and report missing inputs", () => {
    for (const utxos of [[], [funding, funding]]) {
      const result = assessTransactionRisks(transaction(), ctx, { utxos });
      expect(result.status).toBe("incomplete");
      expect(result.findings[0]?.code).toBe("script-output-anyone-can-spend");
      expect(result.errors[0]?.code).toBe("input-unresolved");
    }
  });

  test("recovery is an input availability warning, not new outgoing loss of control", () => {
    const result = assessTransactionRisks(
      transaction({
        spending: [scriptInput.input],
        outputs: [output(address("key"))],
      }),
      ctx,
      { utxos: [scriptInput] },
    );
    expect(result).toMatchObject({
      // This classification-only fixture has no script/redeemer witnesses.
      // Its warning remains informational, but signing now needs those details.
      status: "incomplete",
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "contract-detail-unresolved" }),
      ]),
      findings: [
        {
          action: "spend-script",
          requiresAcknowledgment: false,
          code: "script-input-anyone-can-spend",
          inputRef: scriptInput.input,
        },
      ],
    });
    expect(
      assessResolvedInput(
        {
          ...scriptInput,
          output: { ...scriptInput.output, address: address("unknown") },
        },
        ctx,
      )?.message,
    ).toContain("does not execute");
    const finding = assessResolvedInput(
      scriptInput,
      ctx,
      { version: "V2", cbor: ALWAYS_TRUE_V2.cbor },
      "input-1",
    )!;
    expect(riskFindingsToDraftIssues([finding])[0]).toMatchObject({
      inputRef: scriptInput.input,
      inputId: "input-1",
      level: "warning",
    });
  });

  test("supplied script language/hash mismatch makes input review incomplete", () => {
    const result = assessTransactionRisks(
      transaction({ spending: [scriptInput.input] }),
      ctx,
      {
        utxos: [scriptInput],
        suppliedScripts: [
          {
            inputRef: scriptInput.input,
            script: { version: "V1", cbor: ALWAYS_TRUE_V2.cbor },
          },
        ],
      },
    );
    expect(result.errors[0]?.code).toBe("input-unverified");
    expect(result.status).toBe("incomplete");
  });

  test("imports with reference inputs and collateral return are reviewable without editor reconstruction", () => {
    const result = assessTransactionRisks(
      transaction({
        collateral: [collateral.input],
        returned: output(address("key"), "1500000"),
        total: "500000",
        referenceInputs: [scriptInput.input],
      }),
      ctx,
      { utxos: [funding, collateral] },
    );
    expect(result.status).toBe("complete");
    expect(result.collateral).toMatchObject({
      selectedLovelace: "2000000",
      returnedLovelace: "1500000",
      maximumExposureLovelace: "500000",
      owners: [{ paymentKeyHash: "11".repeat(28) }],
    });
    expect(
      result.findings.filter((f) => f.action === "spend-script"),
    ).toHaveLength(0);
  });

  test("collateral without return exposes the full amount; dangerous return is a conditional output", () => {
    const full = assessTransactionRisks(
      transaction({ collateral: [collateral.input] }),
      ctx,
      { utxos: [funding, collateral] },
    );
    expect(full.collateral?.maximumExposureLovelace).toBe("2000000");
    const returned = assessTransactionRisks(
      transaction({
        outputs: [output(address("key"))],
        collateral: [collateral.input],
        returned: output(address("known"), "1500000"),
        total: "500000",
      }),
      ctx,
      { utxos: [funding, collateral] },
    );
    expect(
      returned.findings.find((f) => f.action === "fund-script"),
    ).toMatchObject({
      outputIndex: 1,
      outputRole: "collateral-return",
      requiresAcknowledgment: true,
      message: expect.stringContaining("If script execution fails"),
    });
  });

  test("invalid total, excessive return, overlapping or unresolved collateral cannot claim verified exposure", () => {
    for (const tx of [
      transaction({ collateral: [collateral.input], total: "1" }),
      transaction({
        collateral: [collateral.input],
        returned: output(address("key"), "3000000"),
        total: "1",
      }),
      transaction({ collateral: [funding.input] }),
      transaction({ collateral: [scriptInput.input] }),
    ]) {
      const result = assessTransactionRisks(tx, ctx, {
        utxos: [funding, collateral],
      });
      expect(result.status).toBe("incomplete");
      expect(result.collateral).toBeUndefined();
      expect(
        result.errors.some((e) => e.code === "collateral-unverified"),
      ).toBe(true);
    }
  });

  test("CBOR network and output networks are checked independently", () => {
    expect(
      assessTransactionRisks(transaction({ network: 1 }), ctx).errors[0]?.code,
    ).toBe("transaction-decode-failed");
    expect(
      assessTransactionRisks(
        transaction({ outputs: [output(address("known", 1))] }),
        ctx,
        { utxos: [funding] },
      ).errors[0]?.code,
    ).toBe("output-unverified");
  });

  test("multiple collateral owners remain distinct and token-bearing collateral is explicitly unsupported", () => {
    const second: UTxO = {
      input: { txHash: "dd".repeat(32), outputIndex: 0 },
      output: {
        address: csl.EnterpriseAddress.new(
          0,
          csl.Credential.from_keyhash(
            csl.Ed25519KeyHash.from_hex("55".repeat(28)),
          ),
        )
          .to_address()
          .to_bech32(),
        amount: [{ unit: "lovelace", quantity: "3000000" }],
      },
    };
    const tx = transaction({
      collateral: [collateral.input, second.input],
      returned: output(address("key"), "4000000"),
      total: "1000000",
    });
    const result = assessTransactionRisks(tx, ctx, {
      utxos: [funding, collateral, second],
    });
    expect(result.status).toBe("complete");
    expect(result.collateral?.owners.map((o) => o.paymentKeyHash)).toEqual([
      "11".repeat(28),
      "55".repeat(28),
    ]);
    expect(result.collateral?.maximumExposureLovelace).toBe("1000000");
    const tokenCollateral = {
      ...collateral,
      output: {
        ...collateral.output,
        amount: [...collateral.output.amount, { unit: TOKEN, quantity: "1" }],
      },
    };
    expect(
      assessTransactionRisks(
        transaction({ collateral: [collateral.input] }),
        ctx,
        { utxos: [funding, tokenCollateral] },
      ),
    ).toMatchObject({
      status: "incomplete",
      errors: [expect.objectContaining({ code: "collateral-unverified" })],
    });
  });

  test("body hash changes with amounts, but not with native witness additions", () => {
    const unsigned = transaction();
    const decoded = csl.Transaction.from_hex(unsigned);
    const witnesses = csl.TransactionWitnessSet.new();
    const natives = csl.NativeScripts.new();
    natives.add(native);
    witnesses.set_native_scripts(natives);
    const withWitness = csl.Transaction.new(decoded.body(), witnesses).to_hex();
    const base = assessTransactionRisks(unsigned, ctx, { utxos: [funding] });
    expect(
      assessTransactionRisks(withWitness, ctx, { utxos: [funding] }),
    ).toEqual(base);
    expect(
      assessTransactionRisks(
        transaction({ outputs: [output(address("known"), "6000000")] }),
        ctx,
        { utxos: [funding] },
      ).txHash,
    ).not.toBe(base.txHash);
  });
});

describe("fresh chain resolution", () => {
  const provider = (live: UTxO[] = [funding]) => ({
    fetchUTxOs: jest.fn().mockResolvedValue([funding]),
    fetchAddressUTxOs: jest.fn().mockResolvedValue(live),
  });
  test("uses live values and never considers a historical spent output sufficient", async () => {
    expect(
      (await resolveTransactionRisks(transaction(), ctx, provider())).status,
    ).toBe("complete");
    const spent = await resolveTransactionRisks(
      transaction(),
      ctx,
      provider([]),
    );
    expect(spent.status).toBe("incomplete");
    expect(spent.findings[0]?.requiresAcknowledgment).toBe(true);
  });

  test("a provider failure or context change never returns a complete assessment", async () => {
    const unavailable = provider();
    unavailable.fetchUTxOs.mockRejectedValue(new Error("offline"));
    expect(
      (await resolveTransactionRisks(transaction(), ctx, unavailable)).status,
    ).toBe("incomplete");
    let current = true;
    const switched = provider();
    switched.fetchAddressUTxOs.mockImplementation(async () => {
      current = false;
      return [funding];
    });
    const result = await resolveTransactionRisks(
      transaction(),
      ctx,
      switched,
      () => current,
    );
    expect(result.errors.some((e) => e.code === "assessment-superseded")).toBe(
      true,
    );
  });

  test("provider output identity and network must match; each call resolves afresh", async () => {
    const p = provider();
    await resolveTransactionRisks(transaction(), ctx, p);
    p.fetchAddressUTxOs.mockResolvedValue([]);
    expect((await resolveTransactionRisks(transaction(), ctx, p)).status).toBe(
      "incomplete",
    );
    expect(p.fetchAddressUTxOs).toHaveBeenCalledTimes(2);
    p.fetchUTxOs.mockResolvedValue([collateral]);
    expect((await resolveTransactionRisks(transaction(), ctx, p)).status).toBe(
      "incomplete",
    );
  });

  test("live chain values win over historical amounts and foreign-network inputs are incomplete", async () => {
    const p = provider([scriptInput]);
    p.fetchUTxOs.mockResolvedValue([
      {
        ...scriptInput,
        output: {
          ...scriptInput.output,
          amount: [{ unit: "lovelace", quantity: "1" }],
        },
      },
    ]);
    const tx = transaction({
      spending: [scriptInput.input],
      outputs: [output(address("key"))],
    });
    expect(
      (await resolveTransactionRisks(tx, ctx, p)).findings[0]?.assets,
    ).toEqual(scriptInput.output.amount);
    const foreign = {
      ...funding,
      output: { ...funding.output, address: address("own", 1) },
    };
    p.fetchUTxOs.mockResolvedValue([foreign]);
    p.fetchAddressUTxOs.mockResolvedValue([foreign]);
    expect(
      (await resolveTransactionRisks(transaction(), ctx, p)).errors[0]?.code,
    ).toBe("input-unverified");
  });

  test("malformed CBOR and an already superseded request do not call the provider", async () => {
    const p = provider();
    expect((await resolveTransactionRisks("zz", ctx, p)).status).toBe(
      "incomplete",
    );
    expect(
      (await resolveTransactionRisks(transaction(), ctx, p, () => false))
        .status,
    ).toBe("incomplete");
    expect(p.fetchUTxOs).not.toHaveBeenCalled();
    expect(p.fetchAddressUTxOs).not.toHaveBeenCalled();
  });
});
