import { MeshTxBuilder, type UTxO } from "@meshsdk/core";

import { applyDraftToTxBuilder } from "@/lib/tx-draft/to-tx-builder";
import {
  addCertificate,
  addOutput,
  addStakeAction,
  addVote,
  createDraft,
  setUtxoSelection,
} from "@/lib/tx-draft/mutations";
import type { DraftCertificate, TxDraft } from "@/types/tx-draft";
import { externalStakeCredential, realTestAddresses } from "./testUtils";

const WALLET_ADDRESS = realTestAddresses.address1;
const RECIPIENT = realTestAddresses.address2;
const SCRIPT_CBOR = "8201828200581c00";

function utxo(
  index: number,
  amount: { unit: string; quantity: string }[],
): UTxO {
  return {
    input: { txHash: "a".repeat(64), outputIndex: index },
    output: { address: WALLET_ADDRESS, amount },
  } as UTxO;
}

/** Bare builder — no fetcher; `complete` is never called in these tests. */
function bareTxBuilder(): MeshTxBuilder {
  return new MeshTxBuilder({});
}

/** Flushes the builder's queued last input/output into the body. */
function body(txBuilder: MeshTxBuilder) {
  (txBuilder as unknown as { queueAllLastItem: () => void }).queueAllLastItem();
  return txBuilder.meshTxBuilderBody;
}

function sendDraft(assets: { unit: string; quantity: string }[]): TxDraft {
  return addOutput(createDraft("d1"), {
    id: "out-1",
    address: RECIPIENT,
    assets,
  }).draft;
}

describe("applyDraftToTxBuilder", () => {
  test("manual mode uses the picked UTxOs exactly, as script inputs", () => {
    const utxos = [
      utxo(0, [{ unit: "lovelace", quantity: "5000000" }]),
      // Deliberately irrelevant to the outputs — keepRelevant would drop it,
      // manual mode must not.
      utxo(1, [{ unit: "policy1token", quantity: "3" }]),
    ];
    const draft = setUtxoSelection(
      sendDraft([{ unit: "lovelace", quantity: "2000000" }]),
      { mode: "manual", utxos },
    );

    const built = body(
      applyDraftToTxBuilder(bareTxBuilder(), draft, {
        inputs: { kind: "script", scriptCbor: SCRIPT_CBOR },
        walletAddress: WALLET_ADDRESS,
        availableUtxos: [],
      }),
    );

    expect(built.inputs).toHaveLength(2);
    expect(built.inputs.map((input) => input.txIn.txIndex)).toEqual([0, 1]);
    for (const input of built.inputs) {
      expect(input.type).not.toBe("PubKey"); // txInScript applied
      expect(input.txIn.address).toBe(WALLET_ADDRESS);
    }
    expect(built.outputs).toHaveLength(1);
    expect(built.outputs[0]).toMatchObject({
      address: RECIPIENT,
      amount: [{ unit: "lovelace", quantity: "2000000" }],
    });
    expect(built.changeAddress).toBe(WALLET_ADDRESS);
  });

  test("auto mode selects relevant UTxOs via keepRelevant", () => {
    const available = [
      utxo(0, [{ unit: "lovelace", quantity: "10000000" }]),
      utxo(1, [{ unit: "policy1token", quantity: "3" }]),
    ];
    const draft = sendDraft([{ unit: "lovelace", quantity: "2000000" }]);

    const built = body(
      applyDraftToTxBuilder(bareTxBuilder(), draft, {
        inputs: { kind: "script", scriptCbor: SCRIPT_CBOR },
        walletAddress: WALLET_ADDRESS,
        availableUtxos: available,
      }),
    );

    // The token-only UTxO is irrelevant to a pure-ADA send.
    expect(built.inputs).toHaveLength(1);
    expect(built.inputs[0]!.txIn.txIndex).toBe(0);
  });

  test("token-only outputs get the min-ADA top-up appended", () => {
    const draft = sendDraft([{ unit: "policy1token", quantity: "5" }]);
    const built = body(
      applyDraftToTxBuilder(bareTxBuilder(), draft, {
        inputs: { kind: "script", scriptCbor: SCRIPT_CBOR },
        walletAddress: WALLET_ADDRESS,
        availableUtxos: [
          utxo(0, [
            { unit: "lovelace", quantity: "10000000" },
            { unit: "policy1token", quantity: "9" },
          ]),
        ],
      }),
    );
    expect(built.outputs[0]!.amount).toEqual([
      { unit: "policy1token", quantity: "5" },
      { unit: "lovelace", quantity: "1160000" },
    ]);
  });

  test("change always goes to the multisig wallet address", () => {
    const draft = sendDraft([{ unit: "lovelace", quantity: "2000000" }]);
    const built = body(
      applyDraftToTxBuilder(bareTxBuilder(), draft, {
        inputs: { kind: "script", scriptCbor: SCRIPT_CBOR },
        walletAddress: WALLET_ADDRESS,
        availableUtxos: [utxo(0, [{ unit: "lovelace", quantity: "10000000" }])],
      }),
    );
    expect(built.changeAddress).toBe(WALLET_ADDRESS);
  });

  test("throws on empty drafts and unfundable auto selections", () => {
    expect(() =>
      applyDraftToTxBuilder(bareTxBuilder(), createDraft("d1"), {
        inputs: { kind: "script", scriptCbor: SCRIPT_CBOR },
        walletAddress: WALLET_ADDRESS,
        availableUtxos: [],
      }),
    ).toThrow(/no outputs/i);

    const draft = sendDraft([{ unit: "lovelace", quantity: "2000000" }]);
    expect(() =>
      applyDraftToTxBuilder(bareTxBuilder(), draft, {
        inputs: { kind: "script", scriptCbor: SCRIPT_CBOR },
        walletAddress: WALLET_ADDRESS,
        availableUtxos: [],
      }),
    ).toThrow(/insufficient/i);
  });
});

describe("applyDraftToTxBuilder votes", () => {
  const DREP_ID = "drep1abcdef";
  const DREP_CBOR = "8201828200581c11";
  const GOV_HASH = "c".repeat(64);

  function voteDraft(
    votes: Array<Partial<import("@/types/tx-draft").DraftVote>>,
    base?: TxDraft,
  ): TxDraft {
    let draft = base ?? createDraft("d1");
    votes.forEach((vote, index) => {
      draft = addVote(draft, {
        id: `v-${index}`,
        govActionTxHash: GOV_HASH,
        govActionIndex: index,
        voteKind: "Yes",
        ...vote,
      } as any).draft;
    });
    return draft;
  }

  const voteCtx = {
    inputs: { kind: "script" as const, scriptCbor: SCRIPT_CBOR },
    walletAddress: WALLET_ADDRESS,
    availableUtxos: [utxo(0, [{ unit: "lovelace", quantity: "10000000" }])],
    drepId: DREP_ID,
    drepScriptCbor: DREP_CBOR,
  };

  test("vote-only draft builds; auto selection gets the 5 ADA fee floor", () => {
    const built = body(
      applyDraftToTxBuilder(bareTxBuilder(), voteDraft([{}]), voteCtx),
    );
    // keepRelevant found the wallet UTxO despite requiredAssetTotals being
    // empty — the vote fee floor forced a lovelace requirement.
    expect(built.inputs).toHaveLength(1);
    expect(built.outputs).toHaveLength(0);
    expect(built.votes).toHaveLength(1);
    expect(built.changeAddress).toBe(WALLET_ADDRESS);
  });

  test("throws without DRep context when votes exist", () => {
    expect(() =>
      applyDraftToTxBuilder(bareTxBuilder(), voteDraft([{}]), {
        inputs: { kind: "script", scriptCbor: SCRIPT_CBOR },
        walletAddress: WALLET_ADDRESS,
        availableUtxos: voteCtx.availableUtxos,
      }),
    ).toThrow(/no DRep context/i);
  });

  test("empty draft still throws", () => {
    expect(() =>
      applyDraftToTxBuilder(bareTxBuilder(), createDraft("d1"), voteCtx),
    ).toThrow(/no outputs, votes or certificates/i);
  });

  test("every vote serializes as SimpleScriptVote with per-vote script", () => {
    const anchor = { anchorUrl: "ipfs://cid", anchorDataHash: "d".repeat(64) };
    const built = body(
      applyDraftToTxBuilder(
        bareTxBuilder(),
        voteDraft([
          { voteKind: "No", anchor },
          { voteKind: "Abstain", govActionIndex: 5 },
        ]),
        voteCtx,
      ),
    );

    expect(built.votes).toHaveLength(2);
    for (const vote of built.votes) {
      // Unlike ballot-created txs, no vote is left as an unwitnessed BasicVote.
      expect(vote.type).toBe("SimpleScriptVote");
      expect((vote as any).vote.voter).toEqual({
        type: "DRep",
        drepId: DREP_ID,
      });
    }
    expect((built.votes[0] as any).vote.votingProcedure).toEqual({
      voteKind: "No",
      anchor,
    });
    expect((built.votes[1] as any).vote.votingProcedure).toEqual({
      voteKind: "Abstain",
    });
    expect((built.votes[1] as any).vote.govActionId).toMatchObject({
      txHash: GOV_HASH,
      txIndex: 5,
    });
  });

  test("a builder-created anchor-less vote emits without an anchor", () => {
    const draft = addVote(createDraft("d1"), {
      id: "v-user",
      govActionTxHash: GOV_HASH,
      govActionIndex: 2,
      voteKind: "No",
    }).draft;
    const built = body(applyDraftToTxBuilder(bareTxBuilder(), draft, voteCtx));
    expect(built.votes).toHaveLength(1);
    expect((built.votes[0] as any).vote.votingProcedure).toEqual({
      voteKind: "No",
    });
    expect((built.votes[0] as any).vote.voter).toEqual({
      type: "DRep",
      drepId: DREP_ID,
    });
  });

  test("votes alongside outputs keep the larger lovelace requirement", () => {
    const draft = voteDraft(
      [{}],
      sendDraft([{ unit: "lovelace", quantity: "8000000" }]),
    );
    const built = body(
      applyDraftToTxBuilder(bareTxBuilder(), draft, {
        ...voteCtx,
        availableUtxos: [
          utxo(0, [{ unit: "lovelace", quantity: "6000000" }]),
          utxo(1, [{ unit: "lovelace", quantity: "6000000" }]),
        ],
      }),
    );
    // 8 ADA output > 5 ADA floor: both UTxOs are needed and selected.
    expect(built.inputs).toHaveLength(2);
    expect(built.outputs).toHaveLength(1);
    expect(built.votes).toHaveLength(1);
  });
});

describe("applyDraftToTxBuilder certificates", () => {
  const REWARD_ADDRESS = externalStakeCredential;
  const STAKE_SCRIPT_CBOR = "8201828200581c22";
  const ORIGINAL_STAKE_ADDRESS = "stake_test1uzoriginal";
  const POOL_ID = "pool1pu5jlj4q9w9jlxeu370a3c9myx47md5j5m2str0naunn2q3lkdy";

  function certDraft(
    certs: Array<Omit<DraftCertificate, "id">>,
    base?: TxDraft,
  ): TxDraft {
    let draft = base ?? createDraft("d1");
    certs.forEach((cert, index) => {
      draft = addCertificate(draft, { id: `c-${index}`, ...cert }).draft;
    });
    return draft;
  }

  const certCtx = {
    inputs: { kind: "script" as const, scriptCbor: SCRIPT_CBOR },
    walletAddress: WALLET_ADDRESS,
    availableUtxos: [utxo(0, [{ unit: "lovelace", quantity: "10000000" }])],
    stakeRewardAddress: REWARD_ADDRESS,
    stakeScriptCbor: STAKE_SCRIPT_CBOR,
  };

  test("cert-only draft builds; auto selection gets the fee floor", () => {
    const built = body(
      applyDraftToTxBuilder(
        bareTxBuilder(),
        certDraft([{ kind: "DelegateStake", poolId: POOL_ID }]),
        certCtx,
      ),
    );
    expect(built.inputs).toHaveLength(1);
    expect(built.outputs).toHaveLength(0);
    expect(built.certificates).toHaveLength(1);
    expect(built.changeAddress).toBe(WALLET_ADDRESS);
  });

  test("certs are re-emitted against the derived reward address, witnessed per cert, in load order", () => {
    const built = body(
      applyDraftToTxBuilder(
        bareTxBuilder(),
        certDraft([
          {
            kind: "RegisterStake",
            originalStakeAddress: ORIGINAL_STAKE_ADDRESS,
          },
          {
            kind: "DelegateStake",
            poolId: POOL_ID,
            originalStakeAddress: ORIGINAL_STAKE_ADDRESS,
          },
        ]),
        certCtx,
      ),
    );

    expect(built.certificates).toHaveLength(2);
    for (const cert of built.certificates) {
      // Per-cert certificateScript: no cert is left unwitnessed.
      expect(cert.type).toBe("SimpleScriptCertificate");
      // Provenance stakeKeyAddress must NOT leak into the rebuilt tx.
      expect((cert as any).certType.stakeKeyAddress).toBe(REWARD_ADDRESS);
    }
    expect(built.certificates.map((c: any) => c.certType.type)).toEqual([
      "RegisterStake",
      "DelegateStake",
    ]);
    expect((built.certificates[1] as any).certType.poolId).toBe(POOL_ID);
  });

  test("an edited pool id lands in the built body", () => {
    const otherPool = "pool1" + "q".repeat(48);
    const built = body(
      applyDraftToTxBuilder(
        bareTxBuilder(),
        certDraft([{ kind: "DelegateStake", poolId: otherPool }]),
        certCtx,
      ),
    );
    expect((built.certificates[0] as any).certType.poolId).toBe(otherPool);
  });

  test("throws without staking context or a delegation pool id", () => {
    expect(() =>
      applyDraftToTxBuilder(
        bareTxBuilder(),
        certDraft([{ kind: "DelegateStake", poolId: POOL_ID }]),
        {
          inputs: { kind: "script", scriptCbor: SCRIPT_CBOR },
          walletAddress: WALLET_ADDRESS,
          availableUtxos: certCtx.availableUtxos,
        },
      ),
    ).toThrow(/no staking context/i);

    expect(() =>
      applyDraftToTxBuilder(
        bareTxBuilder(),
        certDraft([{ kind: "DelegateStake" }]),
        certCtx,
      ),
    ).toThrow(/no pool id/i);
  });

  test("RegisterStake adds 2 ADA deposit headroom to the auto-selection floor", () => {
    // 5 ADA fee floor + 2 ADA deposit = 7 ADA: the 6 ADA UTxO alone is not
    // enough, so keepRelevant must pull in the second one.
    const built = body(
      applyDraftToTxBuilder(
        bareTxBuilder(),
        certDraft([
          { kind: "RegisterStake" },
          { kind: "DelegateStake", poolId: POOL_ID },
        ]),
        {
          ...certCtx,
          availableUtxos: [
            utxo(0, [{ unit: "lovelace", quantity: "6000000" }]),
            utxo(1, [{ unit: "lovelace", quantity: "2000000" }]),
          ],
        },
      ),
    );
    expect(built.inputs).toHaveLength(2);
  });

  test("a builder-created register+delegate pair emits like a loaded one", () => {
    const { draft } = addStakeAction(createDraft("d1"), {
      type: "registerAndDelegate",
      poolId: POOL_ID,
    });
    const built = body(
      applyDraftToTxBuilder(bareTxBuilder(), draft, {
        ...certCtx,
        // 5 ADA floor + 2 ADA deposit: the deposit headroom must apply to
        // user-created registrations too.
        availableUtxos: [
          utxo(0, [{ unit: "lovelace", quantity: "6000000" }]),
          utxo(1, [{ unit: "lovelace", quantity: "2000000" }]),
        ],
      }),
    );
    expect(built.inputs).toHaveLength(2);
    expect(built.certificates.map((c: any) => c.certType.type)).toEqual([
      "RegisterStake",
      "DelegateStake",
    ]);
    for (const cert of built.certificates) {
      expect(cert.type).toBe("SimpleScriptCertificate");
      expect((cert as any).certType.stakeKeyAddress).toBe(REWARD_ADDRESS);
    }
    expect((built.certificates[1] as any).certType.poolId).toBe(POOL_ID);
  });

  test("deregister-only draft builds without deposit headroom", () => {
    const built = body(
      applyDraftToTxBuilder(
        bareTxBuilder(),
        certDraft([{ kind: "DeregisterStake" }]),
        {
          ...certCtx,
          availableUtxos: [utxo(0, [{ unit: "lovelace", quantity: "6000000" }])],
        },
      ),
    );
    expect(built.inputs).toHaveLength(1);
    expect((built.certificates[0] as any).certType.type).toBe(
      "DeregisterStake",
    );
  });
});

describe("applyDraftToTxBuilder rationale edits", () => {
  test("a vote still carrying rationaleEdit builds from its anchor unchanged", () => {
    // The build flow substitutes anchors before applying; if a rationaleEdit
    // ever leaks through, the builder must ignore it and use vote.anchor.
    const anchor = { anchorUrl: "ipfs://old", anchorDataHash: "d".repeat(64) };
    let draft = createDraft("d1");
    draft = addVote(draft, {
      id: "v-1",
      govActionTxHash: "c".repeat(64),
      govActionIndex: 0,
      voteKind: "Yes",
      anchor,
      rationaleEdit: "pending edit",
    } as any).draft;

    const built = body(
      applyDraftToTxBuilder(bareTxBuilder(), draft, {
        inputs: { kind: "script", scriptCbor: SCRIPT_CBOR },
        walletAddress: WALLET_ADDRESS,
        availableUtxos: [utxo(0, [{ unit: "lovelace", quantity: "10000000" }])],
        drepId: "drep1abc",
        drepScriptCbor: "8201828200581c11",
      }),
    );
    expect((built.votes[0] as any).vote.votingProcedure).toEqual({
      voteKind: "Yes",
      anchor,
    });
  });
});
