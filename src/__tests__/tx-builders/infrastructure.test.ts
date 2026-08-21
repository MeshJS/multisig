import { describe, it, expect } from "@jest/globals";
import { MeshTxBuilder } from "@meshsdk/core";
import { getTestTxBuilder } from "./testTxBuilder";

describe("tx-builder test infrastructure", () => {
  it("constructs MeshTxBuilder with mock provider", () => {
    const txBuilder = getTestTxBuilder();
    expect(txBuilder).toBeInstanceOf(MeshTxBuilder);
  });
});
