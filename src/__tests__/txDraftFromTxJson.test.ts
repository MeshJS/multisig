import { MeshTxBuilder } from "@meshsdk/core";

import {
  isDraftCompatible,
  txJsonToDraft,
} from "@/lib/tx-draft/from-tx-json";
import { applyDraftToTxBuilder } from "@/lib/tx-draft/to-tx-builder";
import { addOutput, createDraft } from "@/lib/tx-draft/mutations";
import { realTestAddresses } from "./testUtils";

const WALLET_ADDRESS = realTestAddresses.address1;
const RECIPIENT = realTestAddresses.address2;

const TX_HASH = "a".repeat(64);

function input(txIndex: number, overrides: Record<string, unknown> = {}) {
  return {
    type: "SimpleScript",
    txIn: {
      txHash: TX_HASH,
      txIndex,
      amount: [{ unit: "lovelace", quantity: "10000000" }],
      address: WALLET_ADDRESS,
    },
    ...overrides,
  };
}

function output(address: string, amount: { unit: string; quantity: string }[]) {
  return { address, amount };
}

/** Minimal completed simple-send body, in the shape complete() leaves it. */
function sendBody(overrides: Record<string, unknown> = {}) {
  return {
    inputs: [input(0)],
    outputs: [
      output(RECIPIENT, [{ unit: "lovelace", quantity: "2000000" }]),
      // trailing change output appended by complete()
      output(WALLET_ADDRESS, [{ unit: "lovelace", quantity: "7800000" }]),
    ],
    changeAddress: WALLET_ADDRESS,
    fee: "200000",
    certificates: [],
    votes: [],
    withdrawals: [],
    mints: [],
    collaterals: [],
    referenceInputs: [],
    requiredSignatures: [],
    validityRange: {},
    ...overrides,
  };
}

describe("isDraftCompatible", () => {
  test("accepts a completed simple-send body", () => {
    expect(isDraftCompatible(sendBody())).toEqual({
      compatible: true,
      reasons: [],
    });
  });

  test("accepts the importTransaction shape (missing array keys)", () => {
    const body = {
      inputs: [{ type: "PubKey", txIn: { txHash: TX_HASH, txIndex: 0 } }],
      outputs: [output(RECIPIENT, [{ unit: "lovelace", quantity: "1000000" }])],
      changeAddress: RECIPIENT,
    };
    expect(isDraftCompatible(body).compatible).toBe(true);
  });

  test.each([
    ["certificates", { certificates: [{ type: "BasicCertificate" }] }],
    ["votes", { votes: [{ type: "BasicVote" }] }],
    ["withdrawals", { withdrawals: [{ address: "stake1...", coin: "1" }] }],
    ["mints", { mints: [{ policyId: "p", mintValue: [] }] }],
    ["collaterals", { collaterals: [input(9)] }],
    ["referenceInputs", { referenceInputs: [{ txHash: TX_HASH, txIndex: 1 }] }],
    ["requiredSignatures", { requiredSignatures: ["keyhash"] }],
    [
      "Plutus script input",
      { inputs: [input(0, { type: "Script", scriptTxIn: { redeemer: {} } })] },
    ],
    [
      "output datum",
      {
        outputs: [
          { ...output(RECIPIENT, [{ unit: "lovelace", quantity: "1" }]), datum: { type: "Inline" } },
          output(WALLET_ADDRESS, []),
        ],
      },
    ],
    [
      "output reference script",
      {
        outputs: [
          { ...output(RECIPIENT, [{ unit: "lovelace", quantity: "1" }]), referenceScript: { code: "00" } },
        ],
      },
    ],
    ["validityRange", { validityRange: { invalidHereafter: 123 } }],
    ["imported ttl", { ttl: "123" }],
    ["no inputs", { inputs: [] }],
    ["no outputs", { outputs: [] }],
    [
      "input without a UTxO ref",
      { inputs: [{ type: "PubKey", txIn: { txHash: TX_HASH } }] },
    ],
  ])("rejects a body with %s", (_label, overrides) => {
    const compat = isDraftCompatible(sendBody(overrides));
    expect(compat.compatible).toBe(false);
    expect(compat.reasons.length).toBeGreaterThan(0);
  });

  test("rejects non-object bodies", () => {
    expect(isDraftCompatible(null).compatible).toBe(false);
    expect(isDraftCompatible("nope").compatible).toBe(false);
  });
});

describe("txJsonToDraft", () => {
  test("maps outputs verbatim and strips the trailing change output", () => {
    const { draft, inputRefs, warnings } = txJsonToDraft(sendBody(), {
      walletAddress: WALLET_ADDRESS,
      description: "Payroll",
      metadataMessage: "hello chain",
    });

    expect(draft.outputs).toHaveLength(1);
    expect(draft.outputs[0]).toMatchObject({
      address: RECIPIENT,
      assets: [{ unit: "lovelace", quantity: "2000000" }],
    });
    expect(draft.utxoSelection).toEqual({ mode: "auto" });
    expect(draft.changeAddress).toBeUndefined();
    expect(draft.description).toBe("Payroll");
    expect(draft.metadata).toBe("hello chain");
    expect(inputRefs).toEqual([{ txHash: TX_HASH, txIndex: 0 }]);
    expect(warnings).toEqual([]);
  });

  test("strips split (multiple trailing) change outputs", () => {
    const body = sendBody({
      outputs: [
        output(RECIPIENT, [{ unit: "lovelace", quantity: "2000000" }]),
        output(WALLET_ADDRESS, [{ unit: "lovelace", quantity: "4000000" }]),
        output(WALLET_ADDRESS, [{ unit: "policy1token", quantity: "3" }]),
      ],
    });
    const { draft } = txJsonToDraft(body, { walletAddress: WALLET_ADDRESS });
    expect(draft.outputs).toHaveLength(1);
    expect(draft.outputs[0]!.address).toBe(RECIPIENT);
  });

  test("keeps interior outputs paying the wallet address", () => {
    const body = sendBody({
      outputs: [
        output(WALLET_ADDRESS, [{ unit: "lovelace", quantity: "1500000" }]),
        output(RECIPIENT, [{ unit: "lovelace", quantity: "2000000" }]),
        output(WALLET_ADDRESS, [{ unit: "lovelace", quantity: "7000000" }]),
      ],
    });
    const { draft } = txJsonToDraft(body, { walletAddress: WALLET_ADDRESS });
    expect(draft.outputs.map((o) => o.address)).toEqual([
      WALLET_ADDRESS,
      RECIPIENT,
    ]);
  });

  test("never strips below one output (self-consolidation)", () => {
    const body = sendBody({
      outputs: [
        output(WALLET_ADDRESS, [{ unit: "lovelace", quantity: "9000000" }]),
        output(WALLET_ADDRESS, [{ unit: "lovelace", quantity: "800000" }]),
      ],
    });
    const { draft } = txJsonToDraft(body, { walletAddress: WALLET_ADDRESS });
    expect(draft.outputs).toHaveLength(1);
    expect(draft.outputs[0]!.assets).toEqual([
      { unit: "lovelace", quantity: "9000000" },
    ]);
  });

  test("imported change heuristic: strips nothing, warns", () => {
    // importTransaction sets changeAddress = outputs[0].address
    const body = sendBody({
      changeAddress: RECIPIENT,
      outputs: [
        output(RECIPIENT, [{ unit: "lovelace", quantity: "2000000" }]),
        output(WALLET_ADDRESS, [{ unit: "lovelace", quantity: "7800000" }]),
      ],
    });
    const { draft, warnings } = txJsonToDraft(body, {
      walletAddress: WALLET_ADDRESS,
    });
    expect(draft.outputs).toHaveLength(2);
    expect(warnings).toEqual(["change-not-detected"]);
  });

  test("defaults description/metadata to empty strings", () => {
    const { draft } = txJsonToDraft(sendBody(), {
      walletAddress: WALLET_ADDRESS,
      description: null,
    });
    expect(draft.description).toBe("");
    expect(draft.metadata).toBe("");
  });

  test("round-trips a draft through applyDraftToTxBuilder and back", () => {
    const original = addOutput(createDraft("d1"), {
      address: RECIPIENT,
      assets: [
        { unit: "lovelace", quantity: "2000000" },
        { unit: "policy1token", quantity: "7" },
      ],
    }).draft;

    const txBuilder = applyDraftToTxBuilder(new MeshTxBuilder({}), original, {
      scriptCbor: "8201828200581c00",
      walletAddress: WALLET_ADDRESS,
      availableUtxos: [
        {
          input: { txHash: TX_HASH, outputIndex: 0 },
          output: {
            address: WALLET_ADDRESS,
            amount: [
              { unit: "lovelace", quantity: "10000000" },
              { unit: "policy1token", quantity: "9" },
            ],
          },
        } as any,
      ],
    });
    (txBuilder as any).queueAllLastItem();
    const body = JSON.parse(JSON.stringify(txBuilder.meshTxBuilderBody));
    // Simulate what complete() adds: fee and a trailing change output.
    body.fee = "180000";
    body.outputs.push(
      output(WALLET_ADDRESS, [
        { unit: "lovelace", quantity: "6660000" },
        { unit: "policy1token", quantity: "2" },
      ]),
    );

    expect(isDraftCompatible(body).compatible).toBe(true);

    const { draft, inputRefs } = txJsonToDraft(body, {
      walletAddress: WALLET_ADDRESS,
    });
    expect(draft.outputs).toHaveLength(1);
    expect(draft.outputs[0]!.address).toBe(RECIPIENT);
    // min-ADA top-up appended at build time is part of the round-tripped
    // output — quantities themselves come back verbatim.
    expect(draft.outputs[0]!.assets).toEqual(
      expect.arrayContaining([
        { unit: "lovelace", quantity: "2000000" },
        { unit: "policy1token", quantity: "7" },
      ]),
    );
    expect(inputRefs).toEqual([{ txHash: TX_HASH, txIndex: 0 }]);
  });
});
