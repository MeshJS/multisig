import { MeshTxBuilder, type UTxO } from "@meshsdk/core";

import { applyDraftToTxBuilder } from "@/lib/tx-draft/to-tx-builder";
import { addOutput, createDraft, setUtxoSelection } from "@/lib/tx-draft/mutations";
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

  test("explicit change address wins over the wallet address", () => {
    const draft = {
      ...sendDraft([{ unit: "lovelace", quantity: "2000000" }]),
      changeAddress: RECIPIENT,
    };
    const built = body(
      applyDraftToTxBuilder(bareTxBuilder(), draft, {
        scriptCbor: SCRIPT_CBOR,
        walletAddress: WALLET_ADDRESS,
        availableUtxos: [utxo(0, [{ unit: "lovelace", quantity: "10000000" }])],
      }),
    );
    expect(built.changeAddress).toBe(RECIPIENT);
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
