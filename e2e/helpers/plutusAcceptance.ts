import type { MeshTxBuilder } from "@meshsdk/core";
import { csl } from "@meshsdk/core-csl";
import fs from "node:fs";
import path from "node:path";
const manifest = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), "e2e/fixtures/plutus-acceptance.json"),
    "utf8",
  ),
) as {
  cases: { id: string; version: "V1" | "V2" | "V3"; datumSource: string }[];
  validators: {
    version: string;
    code: string;
    hash: string;
    address: string;
    source: string;
    provenance: string;
  }[];
};

export const datumCbor = "01";
export const datumHash = csl
  .hash_plutus_data(csl.PlutusData.from_hex(datumCbor))
  .to_hex();
export const plutusCases = manifest.cases.map((scenario) => ({
  ...scenario,
  version: scenario.version as "V1" | "V2" | "V3",
  script: manifest.validators.find((v) => v.version === scenario.version)!,
}));
export type PlutusCase = (typeof plutusCases)[number];

/** Fixture-only hash-output funding; does not widen the user-facing output editor. */
export function addFixtureFunding(
  builder: MeshTxBuilder,
  scenario: PlutusCase,
) {
  builder.txOut(scenario.script.address, [
    { unit: "lovelace", quantity: "5000000" },
  ]);
  if (scenario.datumSource === "inline")
    builder.txOutInlineDatumValue(datumCbor, "CBOR");
  else builder.txOutDatumHashValue(datumCbor, "CBOR");
  return builder;
}
