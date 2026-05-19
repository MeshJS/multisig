import { describe, it, expect } from "@jest/globals";
import { MeshTxBuilder } from "@meshsdk/core";
import { getTestTxBuilder } from "./testTxBuilder";
import { decode } from "cbor-x";

describe("tx-builder test infrastructure", () => {
  it("constructs MeshTxBuilder with mock provider", () => {
    const txBuilder = getTestTxBuilder();
    expect(txBuilder).toBeInstanceOf(MeshTxBuilder);
  });

  it("cbor-x decodes a round-trip Buffer", () => {
    const encoded = Buffer.from("82 01 02".replace(/ /g, ""), "hex"); // [1, 2]
    const decoded = decode(encoded);
    expect(decoded).toEqual([1, 2]);
  });
});
