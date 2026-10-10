import { describe, expect, it } from "@jest/globals";
import { csl } from "@meshsdk/core-csl";

import { extractTxMetadataMessage } from "@/utils/txCborMetadata";

function buildTxHex(msg?: string | string[]): string {
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
    csl.TransactionOutput.new(
      outAddr,
      csl.Value.new(csl.BigNum.from_str("1000000")),
    ),
  );

  const body = csl.TransactionBody.new(
    inputs,
    outputs,
    csl.BigNum.from_str("100000"),
    undefined,
  );

  let auxData: csl.AuxiliaryData | undefined;
  if (msg !== undefined) {
    const metadata = csl.GeneralTransactionMetadata.new();
    metadata.insert(
      csl.BigNum.from_str("674"),
      csl.encode_json_str_to_metadatum(
        JSON.stringify({ msg }),
        csl.MetadataJsonSchema.BasicConversions,
      ),
    );
    auxData = csl.AuxiliaryData.new();
    auxData.set_metadata(metadata);
  }

  return csl.Transaction.new(
    body,
    csl.TransactionWitnessSet.new(),
    auxData,
  ).to_hex();
}

describe("extractTxMetadataMessage", () => {
  it("reads a plain string message", () => {
    expect(extractTxMetadataMessage(buildTxHex("hello chain"))).toBe(
      "hello chain",
    );
  });

  it("joins chunked messages without a separator", () => {
    // newTransaction splits messages >63 chars via .match(/.{1,63}/g)
    const long = "x".repeat(63) + "y".repeat(63) + "tail";
    const chunks = long.match(/.{1,63}/g)!;
    expect(chunks.length).toBeGreaterThan(1);
    expect(extractTxMetadataMessage(buildTxHex(chunks))).toBe(long);
  });

  it("returns undefined when the tx has no auxiliary data", () => {
    expect(extractTxMetadataMessage(buildTxHex())).toBeUndefined();
  });

  it("returns undefined on garbage input", () => {
    expect(extractTxMetadataMessage("not-hex")).toBeUndefined();
    expect(extractTxMetadataMessage("")).toBeUndefined();
  });
});
