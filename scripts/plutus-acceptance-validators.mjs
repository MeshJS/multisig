// Reproducible test validators. No networking, keys or chain operations.
import fs from "node:fs";
import assert from "node:assert/strict";
import {
  UPLCProgram,
  Lambda,
  UPLCConst,
  compileUPLC,
  showUPLC,
} from "@harmoniclabs/uplc";
import { Cbor, CborBytes } from "@harmoniclabs/cbor";
import { resolvePlutusScriptAddress, resolveScriptHash } from "@meshsdk/core";

// Ledger calling conventions, not a relabelling of the V2 binary:
// https://plutus.cardano.intersectmbo.org/docs/working-with-scripts/ledger-language-version
// V1 spending: datum -> redeemer -> context -> unit (UPLC 1.0.0).
// V3: context -> unit (UPLC 1.1.0). Datum/redeemer live inside context.
function compile(version, argumentsCount) {
  let term = UPLCConst.unit;
  for (let i = 0; i < argumentsCount; i++) term = new Lambda(term);
  const flat = compileUPLC(new UPLCProgram(version, term)).toBuffer().buffer;
  return {
    source: `(program ${version.join(".")} ${showUPLC(term)})`,
    code: Cbor.encode(
      new CborBytes(Cbor.encode(new CborBytes(flat)).toBuffer()),
    ).toString(),
  };
}
const validators = [
  {
    version: "V1",
    ...compile([1, 0, 0], 3),
    provenance:
      "Repository-authored UPLC; three arguments, returns unit; compiled with locked @harmoniclabs/uplc.",
  },
  {
    version: "V2",
    code: "49480100002221200101",
    source: "Published Hydra always-true V2 fixture",
    provenance:
      "https://hydra.family/head-protocol/unstable/docs/how-to/commit-script-utxo",
  },
  {
    version: "V3",
    ...compile([1, 1, 0], 1),
    provenance:
      "Repository-authored UPLC; one context argument, returns unit; compiled with locked @harmoniclabs/uplc.",
  },
].map((script) => ({
  ...script,
  hash: resolveScriptHash(script.code, script.version),
  address: resolvePlutusScriptAddress(script, 0),
}));
const manifest = {
  warning:
    "Anyone can spend these test validators. Disposable preprod ADA only.",
  languageContract:
    "https://plutus.cardano.intersectmbo.org/docs/working-with-scripts/ledger-language-version",
  validators,
  cases: [
    { id: "v1-supplied", version: "V1", datumSource: "supplied" },
    { id: "v2-inline", version: "V2", datumSource: "inline" },
    { id: "v2-supplied", version: "V2", datumSource: "supplied" },
    { id: "v3-inline", version: "V3", datumSource: "inline" },
    { id: "v3-supplied", version: "V3", datumSource: "supplied" },
  ],
};
const target = new URL(
  "../e2e/fixtures/plutus-acceptance.json",
  import.meta.url,
);
if (process.argv.includes("--write"))
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + "\n");
else assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), manifest);
console.log(JSON.stringify({ reproducible: true, validators }, null, 2));
