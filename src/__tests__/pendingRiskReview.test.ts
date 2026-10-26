import { csl } from "@meshsdk/core-csl";
import { resolveTxHash } from "@meshsdk/core-cst";
import { resolveTransactionRisks } from "@/lib/tx-risk/transaction";
import { reviewPendingTransaction } from "@/lib/tx-risk/pending-review";
import {
  address,
  collateral,
  ctx,
  funding,
  output,
  transaction,
  HUGE_QUANTITY,
  contractReviewTransaction,
  scriptInput,
} from "./fixtures/tx-risk";

function setup(hex = transaction()) {
  const live = [funding, collateral];
  const provider = {
    fetchUTxOs: jest.fn(async () => live),
    fetchAddressUTxOs: jest.fn(async () => live),
  };
  const confirm = jest.fn(
    async (_risk: Awaited<ReturnType<typeof resolveTransactionRisks>>) => ({
      accepted: true,
      acknowledged: true,
    }),
  );
  const options = {
    network: 0,
    isCurrent: () => true,
    refresh: () => resolveTransactionRisks(hex, ctx, provider),
    confirm,
  };
  return { hex, provider, options, confirm };
}

describe("independent pending transaction review", () => {
  test.each(["datum", "redeemer"])(
    "G3 fixture: changing only %s preserves payments but changes the signed body",
    async (field) => {
      const original = contractReviewTransaction();
      const changed = contractReviewTransaction(
        field === "datum" ? "d8799f03ff" : undefined,
        field === "redeemer" ? "d8799f04ff" : undefined,
      );
      const decoded = csl.Transaction.from_hex(changed);
      expect(decoded.body().outputs().get(0).plutus_data()!.to_hex()).toBe(
        field === "datum" ? "d8799f03ff" : "d8799f01ff",
      );
      const redeemer = decoded.witness_set().redeemers()!.get(0);
      expect(redeemer.data().to_hex()).toBe(
        field === "redeemer" ? "d8799f04ff" : "d8799f02ff",
      );
      expect(redeemer.ex_units().mem().to_str()).toBe("10000");
      expect(redeemer.ex_units().steps().to_str()).toBe("1000000");
      expect(resolveTxHash(changed)).not.toBe(resolveTxHash(original));
      const provider = {
        fetchUTxOs: async () => [scriptInput, collateral],
        fetchAddressUTxOs: async () => [scriptInput, collateral],
      };
      const before = await resolveTransactionRisks(original, ctx, provider);
      const after = await resolveTransactionRisks(changed, ctx, provider);
      expect(before.status).toBe("complete");
      expect(after.status).toBe("complete");
      expect(
        after.outputs.map(({ address, assets }) => ({ address, assets })),
      ).toEqual(
        before.outputs.map(({ address, assets }) => ({ address, assets })),
      );
    },
  );
  test("funding-only imported bytes preserve duplicate output and exact token exposure", async () => {
    const { hex, options, confirm } = setup(
      transaction({
        outputs: [output(), output(address("known"), "7000000", true)],
      }),
    );
    expect(await reviewPendingTransaction(hex, options)).toBe(true);
    const risk = confirm.mock.calls[0]![0];
    expect(risk.findings.map((f) => f.outputIndex)).toEqual([0, 1]);
    expect(risk.findings[1]!.assets).toContainEqual(
      expect.objectContaining({ quantity: HUGE_QUANTITY }),
    );
  });

  test.each([
    { accepted: false, acknowledged: true },
    { accepted: true, acknowledged: false },
  ])("refuses cancellation or missing acknowledgment: %j", async (decision) => {
    const { hex, options, confirm } = setup();
    confirm.mockResolvedValue(decision);
    expect(await reviewPendingTransaction(hex, options)).toBe(false);
  });

  test("a second signer and collateral-owner re-signing each need another decision", async () => {
    const { hex, options, confirm } = setup();
    expect(await reviewPendingTransaction(hex, options)).toBe(true);
    confirm.mockResolvedValue({ accepted: true, acknowledged: false });
    expect(await reviewPendingTransaction(hex, options)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  test("unknown contracts remain usable and verified own-wallet payments stay concise", async () => {
    for (const kind of ["unknown", "own"] as const) {
      const { hex, options, confirm } = setup(
        transaction({ outputs: [output(address(kind))] }),
      );
      confirm.mockResolvedValue({ accepted: true, acknowledged: false });
      expect(await reviewPendingTransaction(hex, options)).toBe(true);
      expect(confirm).toHaveBeenCalledTimes(kind === "own" ? 0 : 1);
    }
  });

  test("malformed bytes and unavailable mandatory inputs cannot authorize signing", async () => {
    const malformed = setup("bad-cbor");
    expect(
      await reviewPendingTransaction(malformed.hex, malformed.options),
    ).toBe(false);
    const missing = setup();
    missing.provider.fetchUTxOs.mockRejectedValue(new Error("offline"));
    expect(await reviewPendingTransaction(missing.hex, missing.options)).toBe(
      false,
    );
    expect(
      (await missing.options.refresh()).findings[0]!.requiresAcknowledgment,
    ).toBe(true);
    expect(missing.confirm).not.toHaveBeenCalled();
  });

  test("account/replacement changes during confirmation invalidate approval", async () => {
    const { hex, options, confirm } = setup();
    let current = true;
    options.isCurrent = () => current;
    confirm.mockImplementation(async () => {
      current = false;
      return { accepted: true, acknowledged: true };
    });
    expect(await reviewPendingTransaction(hex, options)).toBe(false);
  });

  test("newly spent inputs after acknowledgment require a fresh review", async () => {
    const { hex, options, confirm, provider } = setup();
    confirm.mockImplementation(async () => {
      provider.fetchAddressUTxOs.mockResolvedValue([]);
      return { accepted: true, acknowledged: true };
    });
    await expect(reviewPendingTransaction(hex, options)).rejects.toThrow(
      /facts changed/,
    );
  });

  test("imported collateral return reduces exposure; spent collateral blocks signing", async () => {
    const { hex, options, confirm, provider } = setup(
      transaction({
        collateral: [collateral.input],
        returned: output(address("key"), "1500000"),
        total: "500000",
      }),
    );
    expect(await reviewPendingTransaction(hex, options)).toBe(true);
    expect(confirm.mock.calls[0]![0].collateral).toMatchObject({
      selectedLovelace: "2000000",
      returnedLovelace: "1500000",
      maximumExposureLovelace: "500000",
    });
    provider.fetchAddressUTxOs.mockResolvedValue([funding]);
    expect(await reviewPendingTransaction(hex, options)).toBe(false);
  });

  test("additional witnesses preserve the assessed body and findings", async () => {
    const { hex, options } = setup();
    const tx = csl.Transaction.from_hex(hex);
    const witnesses = tx.witness_set();
    const scripts = csl.PlutusScripts.new();
    scripts.add(
      csl.PlutusScript.from_hex_with_version(
        "49480100002221200101",
        csl.Language.new_plutus_v2(),
      ),
    );
    witnesses.set_plutus_scripts(scripts);
    const withWitness = csl.Transaction.new(tx.body(), witnesses).to_hex();
    const second = setup(withWitness);
    expect(withWitness).not.toBe(hex);
    expect(await options.refresh()).toEqual(await second.options.refresh());
    expect(await reviewPendingTransaction(withWitness, second.options)).toBe(
      true,
    );
  });
});
