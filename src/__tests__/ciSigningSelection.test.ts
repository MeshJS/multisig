import { describe, expect, it } from "@jest/globals";
import {
  SIGN_TRANSACTION_REQUEST_OPTIONS,
  selectPendingTransactionForSigning,
} from "../../scripts/ci/scenarios/flows/signingFlow";

describe("route-chain pending transaction selection", () => {
  it("does not retry signTransaction after a witness may have been recorded", () => {
    expect(SIGN_TRANSACTION_REQUEST_OPTIONS).toEqual({ retries: 0 });
  });

  it("selects the preferred transaction when present", () => {
    expect(
      selectPendingTransactionForSigning(
        [
          { id: "stale", txCbor: "deadbeef" },
          { id: "target", txCbor: "cafebabe" },
        ],
        "target",
      ),
    ).toEqual({ id: "target", txCbor: "cafebabe" });
  });

  it("fails instead of falling back when the preferred transaction is missing", () => {
    expect(() =>
      selectPendingTransactionForSigning(
        [
          { id: "stale", txCbor: "deadbeef" },
          { id: "other", txCbor: "cafebabe" },
        ],
        "target",
      ),
    ).toThrow(/Preferred pending transaction target was not found/);
  });

  it("fails instead of falling back when the preferred transaction has no txCbor", () => {
    expect(() =>
      selectPendingTransactionForSigning(
        [
          { id: "target" },
          { id: "other", txCbor: "cafebabe" },
        ],
        "target",
      ),
    ).toThrow(/Preferred pending transaction target does not include txCbor/);
  });

  it("keeps the old first-signable fallback when no preferred id is provided", () => {
    expect(
      selectPendingTransactionForSigning([
        { id: "empty" },
        { id: "first-signable", txCbor: "deadbeef" },
      ]),
    ).toEqual({ id: "first-signable", txCbor: "deadbeef" });
  });
});
