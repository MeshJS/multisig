import { MeshTxBuilder, resolvePoolId } from "@meshsdk/core";

import {
  isDraftCompatible,
  txJsonToDraft,
} from "@/lib/tx-draft/from-tx-json";
import { applyDraftToTxBuilder } from "@/lib/tx-draft/to-tx-builder";
import {
  addCertificate,
  addOutput,
  createDraft,
} from "@/lib/tx-draft/mutations";
import { externalStakeCredential, realTestAddresses } from "./testUtils";

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

function drepVote(overrides: Record<string, unknown> = {}, type = "BasicVote") {
  return {
    type,
    vote: {
      voter: { type: "DRep", drepId: "drep1abc" },
      govActionId: { txHash: "c".repeat(64), txIndex: 3 },
      votingProcedure: { voteKind: "Yes" },
      ...overrides,
    },
  };
}

function scriptVote() {
  return {
    type: "ScriptVote",
    vote: drepVote().vote,
    redeemer: {},
    scriptSource: { type: "Provided" },
  };
}

const STAKE_ADDRESS = externalStakeCredential;
const POOL_HEX = "f".repeat(56);
const POOL_BECH32 = resolvePoolId(POOL_HEX);

function stakeCert(
  certType: Record<string, unknown>,
  type = "SimpleScriptCertificate",
) {
  return {
    type,
    certType,
    ...(type === "SimpleScriptCertificate"
      ? { simpleScriptSource: { type: "Provided", scriptCode: "00" } }
      : {}),
  };
}

function delegateCert(poolId: string = POOL_HEX, type?: string) {
  return stakeCert(
    { type: "DelegateStake", stakeKeyAddress: STAKE_ADDRESS, poolId },
    type,
  );
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
    [
      "Plutus script certificates",
      {
        certificates: [
          {
            type: "ScriptCertificate",
            certType: delegateCert().certType,
            scriptSource: { type: "Provided" },
          },
        ],
      },
    ],
    [
      "unsupported certificate types (VoteDelegation)",
      {
        certificates: [
          stakeCert({
            type: "VoteDelegation",
            stakeKeyAddress: STAKE_ADDRESS,
            drep: { dRepId: "drep1abc" },
          }),
        ],
      },
    ],
    [
      "unsupported certificate types (RegisterPool)",
      { certificates: [stakeCert({ type: "RegisterPool" })] },
    ],
    [
      "unsupported certificate types (StakeRegistrationAndDelegation)",
      {
        certificates: [
          stakeCert({
            type: "StakeRegistrationAndDelegation",
            stakeKeyAddress: STAKE_ADDRESS,
            poolId: POOL_HEX,
            coin: 2000000,
          }),
        ],
      },
    ],
    [
      "malformed certificate (missing stakeKeyAddress)",
      { certificates: [stakeCert({ type: "RegisterStake" })] },
    ],
    [
      "malformed certificate (DelegateStake without poolId)",
      {
        certificates: [
          stakeCert({ type: "DelegateStake", stakeKeyAddress: STAKE_ADDRESS }),
        ],
      },
    ],
    ["Plutus script votes", { votes: [scriptVote()] }],
    ["non-DRep votes", { votes: [drepVote({ voter: { type: "StakingPool", keyHash: "kh" } })] }],
    ["malformed vote data", { votes: [drepVote({ votingProcedure: { voteKind: "Maybe" } })] }],
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

describe("vote transactions", () => {
  const GOV_HASH = "c".repeat(64);

  function voteBody(votes: unknown[], overrides: Record<string, unknown> = {}) {
    return sendBody({
      votes,
      // A completed vote-only body: the only output is the change output.
      outputs: [
        output(WALLET_ADDRESS, [{ unit: "lovelace", quantity: "9800000" }]),
      ],
      ...overrides,
    });
  }

  test("accepts the mixed BasicVote + SimpleScriptVote ballot shape", () => {
    const body = voteBody([
      drepVote(),
      { ...drepVote(), type: "SimpleScriptVote", simpleScriptSource: { type: "Provided" } },
    ]);
    expect(isDraftCompatible(body)).toEqual({ compatible: true, reasons: [] });
  });

  test("vote-only body does not trip the no-outputs gate", () => {
    const body = voteBody([drepVote()], { outputs: [] });
    expect(isDraftCompatible(body).compatible).toBe(true);
  });

  test("txJsonToDraft maps votes and strips the lone change output to zero", () => {
    const anchor = { anchorUrl: "ipfs://cid", anchorDataHash: "d".repeat(64) };
    const body = voteBody([
      drepVote({ votingProcedure: { voteKind: "No", anchor } }),
      drepVote({ govActionId: { txHash: GOV_HASH, txIndex: 7 } }),
    ]);

    const { draft } = txJsonToDraft(body, { walletAddress: WALLET_ADDRESS });

    expect(draft.outputs).toHaveLength(0);
    expect(draft.votes).toHaveLength(2);
    expect(draft.votes[0]).toMatchObject({
      govActionTxHash: GOV_HASH,
      govActionIndex: 3,
      voteKind: "No",
      anchor,
      originalDrepId: "drep1abc",
    });
    expect(draft.votes[1]).toMatchObject({
      govActionIndex: 7,
      voteKind: "Yes",
    });
    expect(draft.votes[1]!.anchor).toBeUndefined();
    expect(draft.votes[0]!.id).not.toBe(draft.votes[1]!.id);
  });

  test("vote tx with a real payment keeps the payment, strips only change", () => {
    const body = voteBody([drepVote()], {
      outputs: [
        output(RECIPIENT, [{ unit: "lovelace", quantity: "2000000" }]),
        output(WALLET_ADDRESS, [{ unit: "lovelace", quantity: "7000000" }]),
      ],
    });
    const { draft } = txJsonToDraft(body, { walletAddress: WALLET_ADDRESS });
    expect(draft.outputs.map((o) => o.address)).toEqual([RECIPIENT]);
    expect(draft.votes).toHaveLength(1);
  });

  test("send-only bodies still keep at least one output (regression)", () => {
    const body = sendBody({
      outputs: [
        output(WALLET_ADDRESS, [{ unit: "lovelace", quantity: "9000000" }]),
        output(WALLET_ADDRESS, [{ unit: "lovelace", quantity: "800000" }]),
      ],
    });
    const { draft } = txJsonToDraft(body, { walletAddress: WALLET_ADDRESS });
    expect(draft.outputs).toHaveLength(1);
  });
});

describe("staking certificate transactions", () => {
  function certBody(
    certificates: unknown[],
    overrides: Record<string, unknown> = {},
  ) {
    return sendBody({
      certificates,
      // A completed delegation-only body: the only output is the change.
      outputs: [
        output(WALLET_ADDRESS, [{ unit: "lovelace", quantity: "9800000" }]),
      ],
      ...overrides,
    });
  }

  test("accepts a delegation-only body (SimpleScriptCertificate)", () => {
    expect(isDraftCompatible(certBody([delegateCert()]))).toEqual({
      compatible: true,
      reasons: [],
    });
  });

  test("accepts the BasicCertificate shape too", () => {
    const body = certBody([delegateCert(POOL_HEX, "BasicCertificate")]);
    expect(isDraftCompatible(body).compatible).toBe(true);
  });

  test("accepts a register + delegate pair and a deregister body", () => {
    const pair = certBody([
      stakeCert({ type: "RegisterStake", stakeKeyAddress: STAKE_ADDRESS }),
      delegateCert(),
    ]);
    expect(isDraftCompatible(pair).compatible).toBe(true);

    const deregister = certBody([
      stakeCert({ type: "DeregisterStake", stakeKeyAddress: STAKE_ADDRESS }),
    ]);
    expect(isDraftCompatible(deregister).compatible).toBe(true);
  });

  test("cert-only body does not trip the no-outputs gate", () => {
    const body = certBody([delegateCert()], { outputs: [] });
    expect(isDraftCompatible(body).compatible).toBe(true);
  });

  test("withdrawals are still rejected even alongside certificates", () => {
    const body = certBody([delegateCert()], {
      withdrawals: [{ address: STAKE_ADDRESS, coin: "1" }],
    });
    expect(isDraftCompatible(body).compatible).toBe(false);
  });

  test("txJsonToDraft maps certs in order, normalizes hex pool ids and strips the lone change output", () => {
    const body = certBody([
      stakeCert({ type: "RegisterStake", stakeKeyAddress: STAKE_ADDRESS }),
      delegateCert(POOL_HEX),
    ]);

    const { draft } = txJsonToDraft(body, { walletAddress: WALLET_ADDRESS });

    expect(draft.outputs).toHaveLength(0);
    expect(draft.certificates).toHaveLength(2);
    expect(draft.certificates[0]).toMatchObject({
      kind: "RegisterStake",
      originalStakeAddress: STAKE_ADDRESS,
    });
    expect(draft.certificates[0]!.poolId).toBeUndefined();
    expect(draft.certificates[1]).toMatchObject({
      kind: "DelegateStake",
      poolId: POOL_BECH32,
      originalStakeAddress: STAKE_ADDRESS,
    });
    expect(draft.certificates[0]!.id).not.toBe(draft.certificates[1]!.id);
  });

  test("bech32 pool ids come back unchanged", () => {
    const body = certBody([delegateCert(POOL_BECH32)]);
    const { draft } = txJsonToDraft(body, { walletAddress: WALLET_ADDRESS });
    expect(draft.certificates[0]!.poolId).toBe(POOL_BECH32);
  });

  test("a non-normalizable pool id is kept raw for validation to flag", () => {
    const body = certBody([delegateCert("not-a-pool-id")]);
    const { draft } = txJsonToDraft(body, { walletAddress: WALLET_ADDRESS });
    expect(draft.certificates[0]!.poolId).toBe("not-a-pool-id");
  });

  test("cert tx with a real payment keeps the payment, strips only change", () => {
    const body = certBody([delegateCert()], {
      outputs: [
        output(RECIPIENT, [{ unit: "lovelace", quantity: "2000000" }]),
        output(WALLET_ADDRESS, [{ unit: "lovelace", quantity: "7000000" }]),
      ],
    });
    const { draft } = txJsonToDraft(body, { walletAddress: WALLET_ADDRESS });
    expect(draft.outputs.map((o) => o.address)).toEqual([RECIPIENT]);
    expect(draft.certificates).toHaveLength(1);
  });

  test("round-trips a delegation draft through applyDraftToTxBuilder and back", () => {
    let original = createDraft("d2");
    original = addCertificate(original, {
      kind: "RegisterStake",
      originalStakeAddress: STAKE_ADDRESS,
    }).draft;
    original = addCertificate(original, {
      kind: "DelegateStake",
      poolId: POOL_BECH32,
      originalStakeAddress: STAKE_ADDRESS,
    }).draft;

    const txBuilder = applyDraftToTxBuilder(new MeshTxBuilder({}), original, {
      scriptCbor: "8201828200581c00",
      walletAddress: WALLET_ADDRESS,
      availableUtxos: [
        {
          input: { txHash: TX_HASH, outputIndex: 0 },
          output: {
            address: WALLET_ADDRESS,
            amount: [{ unit: "lovelace", quantity: "10000000" }],
          },
        } as any,
      ],
      stakeRewardAddress: STAKE_ADDRESS,
      stakeScriptCbor: "8201828200581c11",
    });
    (txBuilder as any).queueAllLastItem();
    const body = JSON.parse(JSON.stringify(txBuilder.meshTxBuilderBody));
    // Simulate what complete() adds: fee and a trailing change output.
    body.fee = "180000";
    body.outputs.push(
      output(WALLET_ADDRESS, [{ unit: "lovelace", quantity: "7600000" }]),
    );

    // Per-cert certificateScript means every cert serializes witnessed.
    expect(body.certificates.map((c: any) => c.type)).toEqual([
      "SimpleScriptCertificate",
      "SimpleScriptCertificate",
    ]);
    expect(isDraftCompatible(body).compatible).toBe(true);

    const { draft } = txJsonToDraft(body, { walletAddress: WALLET_ADDRESS });
    expect(draft.outputs).toHaveLength(0);
    expect(draft.certificates.map((c) => c.kind)).toEqual([
      "RegisterStake",
      "DelegateStake",
    ]);
    expect(draft.certificates[1]!.poolId).toBe(POOL_BECH32);
  });
});
