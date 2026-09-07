import { describe, expect, it } from "@jest/globals";

import {
  collectSpecUnits,
  hasSpecErrors,
  normalizeTxSpec,
  specToDraft,
  type TxSpecInput,
} from "@/lib/tx-review/spec";

const POLICY = "a".repeat(56);
const HOSKY = `${POLICY}${Buffer.from("HOSKY").toString("hex")}`;
const PROPOSAL = `${"c".repeat(64)}#0`;

const decimals = new Map<string, number>([[HOSKY, 0]]);
const decimalsFor = (unit: string) => decimals.get(unit);

describe("normalizeTxSpec", () => {
  it("converts display amounts to base units without float math", () => {
    const { spec, issues } = normalizeTxSpec(
      {
        walletId: "w",
        outputs: [{ address: "addr_test1qpx", ada: "1.123456", assets: [{ unit: HOSKY, quantity: "1000" }] }],
        description: "  Pay  ",
      },
      { decimalsFor },
    );
    expect(issues).toEqual([]);
    expect(spec.outputs[0]!.assets).toEqual([
      { unit: "lovelace", quantity: "1123456" },
      { unit: HOSKY, quantity: "1000" },
    ]);
    expect(spec.description).toBe("Pay");
    expect(spec.metadataMessage).toBe("");
  });

  it("uses registered decimals for tokens", () => {
    const { spec } = normalizeTxSpec(
      { walletId: "w", outputs: [{ address: "addr_test1qpx", assets: [{ unit: HOSKY, quantity: "2.5" }] }] },
      { decimalsFor: () => 6 },
    );
    expect(spec.outputs[0]!.assets).toEqual([{ unit: HOSKY, quantity: "2500000" }]);
  });

  it("never guesses a token's scale: fractional amounts need known decimals", () => {
    const unknown = `${POLICY}${"bb".repeat(4)}`;
    const fractional = normalizeTxSpec(
      { walletId: "w", outputs: [{ address: "addr_test1qpx", assets: [{ unit: unknown, quantity: "1.5" }] }] },
      { decimalsFor: () => undefined },
    );
    expect(hasSpecErrors(fractional.issues)).toBe(true);
    expect(fractional.issues[0]).toMatchObject({ code: "unknown-decimals", level: "error", outputIndex: 0 });

    // A whole number is accepted as raw units, but says so.
    const whole = normalizeTxSpec(
      { walletId: "w", outputs: [{ address: "addr_test1qpx", assets: [{ unit: unknown, quantity: "7" }] }] },
      { decimalsFor: () => undefined },
    );
    expect(hasSpecErrors(whole.issues)).toBe(false);
    expect(whole.issues[0]).toMatchObject({ code: "unknown-decimals", level: "warning" });
    expect(whole.spec.outputs[0]!.assets).toEqual([{ unit: unknown, quantity: "7" }]);
  });

  it("rejects zero, negative and malformed amounts", () => {
    const { issues } = normalizeTxSpec(
      {
        walletId: "w",
        outputs: [
          { address: "addr_test1qpx", ada: "0" },
          { address: "addr_test1qpy", ada: "abc" },
        ],
      },
      { decimalsFor },
    );
    expect(issues.map((i) => i.code)).toEqual(["invalid-amount", "invalid-amount"]);
  });

  it("parses proposal ids and vote choices, keeping the rationale for later", () => {
    const { spec, issues } = normalizeTxSpec(
      { walletId: "w", votes: [{ proposalId: PROPOSAL.toUpperCase(), vote: "Yes", rationale: "  Because.  " }] },
      { decimalsFor },
    );
    expect(issues).toEqual([]);
    expect(spec.votes).toEqual([
      { govActionTxHash: "c".repeat(64), govActionIndex: 0, voteKind: "Yes", rationale: "Because." },
    ]);
  });

  it("flags a malformed proposal id and an unknown vote kind", () => {
    const { issues } = normalizeTxSpec(
      {
        walletId: "w",
        votes: [
          { proposalId: "not-a-proposal", vote: "Yes" },
          { proposalId: PROPOSAL, vote: "Maybe" },
        ],
      },
      { decimalsFor },
    );
    // Both votes are dropped, so the request is also empty.
    expect(issues.map((i) => i.code)).toEqual(["invalid-proposal-id", "invalid-vote", "no-actions"]);
  });

  it("requires a pool for delegation and rejects unknown certificate kinds", () => {
    const { issues } = normalizeTxSpec(
      { walletId: "w", certificates: [{ kind: "DelegateStake" }, { kind: "Retire" }] },
      { decimalsFor },
    );
    expect(issues.map((i) => i.code)).toEqual(["invalid-pool-id", "invalid-certificate", "no-actions"]);
  });

  it("refuses an empty request", () => {
    const { issues } = normalizeTxSpec({ walletId: "w" }, { decimalsFor });
    expect(issues).toEqual([expect.objectContaining({ code: "no-actions", level: "error" })]);
  });

  it("lists the distinct native units for a metadata lookup", () => {
    const input: TxSpecInput = {
      walletId: "w",
      outputs: [
        { address: "a", ada: "1", assets: [{ unit: HOSKY.toUpperCase(), quantity: "1" }] },
        { address: "b", assets: [{ unit: HOSKY, quantity: "2" }] },
      ],
    };
    expect(collectSpecUnits(input)).toEqual([HOSKY]);
  });
});

describe("specToDraft", () => {
  it("projects deterministically so preview and propose build the same draft", () => {
    const { spec } = normalizeTxSpec(
      {
        walletId: "w",
        outputs: [{ address: "addr_test1qpx", ada: "2" }],
        certificates: [{ kind: "RegisterStake" }],
        votes: [{ proposalId: PROPOSAL, vote: "No", rationale: "r" }],
        description: "d",
        metadataMessage: "m",
      },
      { decimalsFor },
    );
    const a = specToDraft(spec, "id");
    const b = specToDraft(spec, "id");
    expect(a).toEqual(b);
    expect(a.source).toEqual({ kind: "multisig" });
    expect(a.utxoSelection).toEqual({ mode: "auto" });
    expect(a.outputs[0]).toMatchObject({ id: "out-0", address: "addr_test1qpx" });
    expect(a.certificates[0]).toMatchObject({ id: "cert-0", kind: "RegisterStake", origin: "user" });
    // The rationale rides as an edit: the builder ignores it, so the preview
    // is anchor-less, and propose swaps it for a real anchor after pinning.
    expect(a.votes[0]).toMatchObject({ id: "vote-0", voteKind: "No", rationaleEdit: "r" });
    expect(a.votes[0]!.anchor).toBeUndefined();
    expect(a.description).toBe("d");
    expect(a.metadata).toBe("m");
  });
});
