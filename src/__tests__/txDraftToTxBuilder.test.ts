import { MeshTxBuilder, type UTxO } from "@meshsdk/core";

import { applyDraftToTxBuilder } from "@/lib/tx-draft/to-tx-builder";
import {
  addOutput,
  addVote,
  createDraft,
  setUtxoSelection,
} from "@/lib/tx-draft/mutations";
import type { TxDraft } from "@/types/tx-draft";
import { realTestAddresses } from "./testUtils";

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
        scriptCbor: SCRIPT_CBOR,
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
        scriptCbor: SCRIPT_CBOR,
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
        scriptCbor: SCRIPT_CBOR,
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
        scriptCbor: SCRIPT_CBOR,
        walletAddress: WALLET_ADDRESS,
        availableUtxos: [utxo(0, [{ unit: "lovelace", quantity: "10000000" }])],
      }),
    );
    expect(built.changeAddress).toBe(WALLET_ADDRESS);
  });

  test("throws on empty drafts and unfundable auto selections", () => {
    expect(() =>
      applyDraftToTxBuilder(bareTxBuilder(), createDraft("d1"), {
        scriptCbor: SCRIPT_CBOR,
        walletAddress: WALLET_ADDRESS,
        availableUtxos: [],
      }),
    ).toThrow(/no outputs/i);

    const draft = sendDraft([{ unit: "lovelace", quantity: "2000000" }]);
    expect(() =>
      applyDraftToTxBuilder(bareTxBuilder(), draft, {
        scriptCbor: SCRIPT_CBOR,
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
    scriptCbor: SCRIPT_CBOR,
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
        scriptCbor: SCRIPT_CBOR,
        walletAddress: WALLET_ADDRESS,
        availableUtxos: voteCtx.availableUtxos,
      }),
    ).toThrow(/no DRep context/i);
  });

  test("empty draft still throws", () => {
    expect(() =>
      applyDraftToTxBuilder(bareTxBuilder(), createDraft("d1"), voteCtx),
    ).toThrow(/no outputs or votes/i);
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
        scriptCbor: SCRIPT_CBOR,
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
