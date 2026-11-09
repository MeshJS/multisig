import { MeshTxBuilder, type IFetcher } from "@meshsdk/core";
import { csl } from "@meshsdk/core-csl";
import {
  addFixtureFunding,
  datumCbor,
  datumHash,
  plutusCases,
} from "../../e2e/helpers/plutusAcceptance";
import { address, funding } from "./fixtures/tx-risk";
import { createMockProvider } from "./tx-builders/mockProvider";

test.each(plutusCases)(
  "$id funding encodes the intended datum and script identity",
  async (scenario) => {
    const utxo = {
      ...funding,
      output: { ...funding.output, address: address("key") },
    };
    const provider = createMockProvider({ utxos: [utxo] });
    const builder = new MeshTxBuilder({
      fetcher: provider as unknown as IFetcher,
    });
    addFixtureFunding(builder, scenario)
      .changeAddress(utxo.output.address)
      .selectUtxosFrom([utxo]);
    const tx = csl.Transaction.from_hex(await builder.complete());
    const output = tx.body().outputs().get(0);
    expect(output.address().payment_cred()!.to_scripthash()!.to_hex()).toBe(
      scenario.script.hash,
    );
    expect(output.amount().coin().to_str()).toBe("5000000");
    if (scenario.datumSource === "inline") {
      expect(output.plutus_data()!.to_hex()).toBe(datumCbor);
      expect(output.data_hash()).toBeUndefined();
    } else {
      expect(output.data_hash()!.to_hex()).toBe(datumHash);
      expect(output.plutus_data()).toBeUndefined();
    }
    expect(tx.witness_set().vkeys()?.len() ?? 0).toBe(0);
  },
);

test("each language has its own recorded bytes and V1 never advertises inline support", () => {
  expect(plutusCases).toHaveLength(5);
  expect(new Set(plutusCases.map((c) => c.script.code)).size).toBe(3);
  expect(
    plutusCases.filter((c) => c.version === "V1").map((c) => c.datumSource),
  ).toEqual(["supplied"]);
});
