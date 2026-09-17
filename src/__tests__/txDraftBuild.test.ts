import { MeshTxBuilder, type UTxO } from "@meshsdk/core";
import { csl } from "@meshsdk/core-csl";
import { resolveTxHash } from "@meshsdk/core-cst";

import { buildDraftTx } from "@/lib/tx-draft/build-draft-tx";
import { addOutput, createDraft, setUtxoSelection } from "@/lib/tx-draft/mutations";
import type { TxDraft } from "@/types/tx-draft";
import { realTestAddresses } from "./testUtils";

const WALLET_ADDRESS = realTestAddresses.address1;
const RECIPIENT = realTestAddresses.address2;
const SCRIPT_CBOR = "8201828200581c00";
const FEE = "180000";

function utxo(index: number, lovelace: string): UTxO {
  return {
    input: { txHash: "a".repeat(64), outputIndex: index },
    output: {
      address: WALLET_ADDRESS,
      amount: [{ unit: "lovelace", quantity: lovelace }],
    },
  } as UTxO;
}

function sendDraft(lovelace: string): TxDraft {
  const draft = addOutput(createDraft("d1"), {
    id: "out-1",
    address: RECIPIENT,
    assets: [{ unit: "lovelace", quantity: lovelace }],
  }).draft;
  return setUtxoSelection(draft, {
    mode: "manual",
    utxos: [utxo(0, "5000000")],
  });
}

/** A syntactically valid unsigned tx so the hash can be resolved. */
function minimalTxHex(): string {
  const inputs = csl.TransactionInputs.new();
  inputs.add(
    csl.TransactionInput.new(
      csl.TransactionHash.from_bytes(Buffer.from("00".repeat(32), "hex")),
      0,
    ),
  );
  const outputs = csl.TransactionOutputs.new();
  outputs.add(
    csl.TransactionOutput.new(
      csl.Address.from_bech32(RECIPIENT),
      csl.Value.new(csl.BigNum.from_str("1000000")),
    ),
  );
  const body = csl.TransactionBody.new(
    inputs,
    outputs,
    csl.BigNum.from_str(FEE),
    undefined,
  );
  return csl.Transaction.new(
    body,
    csl.TransactionWitnessSet.new(),
    undefined,
  ).to_hex();
}

/**
 * Stands in for `MeshTxBuilder.complete()` without a provider: flushes the
 * queued input/output into the body, then does what `complete()` leaves
 * behind — a fee and a trailing change output.
 */
function fakeComplete(txHex: string) {
  const calls: string[] = [];
  const complete = async (txBuilder: MeshTxBuilder) => {
    calls.push("complete");
    (txBuilder as unknown as { queueAllLastItem: () => void }).queueAllLastItem();
    txBuilder.meshTxBuilderBody.fee = FEE;
    txBuilder.meshTxBuilderBody.outputs.push({
      address: txBuilder.meshTxBuilderBody.changeAddress,
      amount: [{ unit: "lovelace", quantity: "2820000" }],
    });
    return txHex;
  };
  return { complete, calls };
}

describe("buildDraftTx", () => {
  test("applies the draft and metadata, completes once, and reports the result", async () => {
    const txHex = minimalTxHex();
    const { complete, calls } = fakeComplete(txHex);
    const txBuilder = new MeshTxBuilder({});

    const result = await buildDraftTx(
      txBuilder,
      sendDraft("2000000"),
      {
        inputs: { kind: "script", scriptCbor: SCRIPT_CBOR },
        walletAddress: WALLET_ADDRESS,
        availableUtxos: [],
      },
      { metadataMessage: "Test build", complete },
    );

    expect(calls).toEqual(["complete"]);
    expect(result.unsignedTx).toBe(txHex);
    expect(result.txHash).toBe(resolveTxHash(txHex).toLowerCase());
    expect(result.fee).toBe(FEE);
    expect(result.sizeBytes).toBe(txHex.length / 2);
    expect(result.inputCount).toBe(1);
    // payment + change appended by complete()
    expect(result.outputCount).toBe(2);
    expect(result.body.changeAddress).toBe(WALLET_ADDRESS);
    expect(result.body.outputs[0]).toMatchObject({ address: RECIPIENT });
    // Mesh normalizes metadatum objects into Maps.
    expect(result.body.metadata.get(674n)).toEqual(
      new Map([["msg", "Test build"]]),
    );
  });

  test("omits metadata when there is no message", async () => {
    const { complete } = fakeComplete(minimalTxHex());
    const txBuilder = new MeshTxBuilder({});

    const result = await buildDraftTx(
      txBuilder,
      sendDraft("2000000"),
      {
        inputs: { kind: "script", scriptCbor: SCRIPT_CBOR },
        walletAddress: WALLET_ADDRESS,
        availableUtxos: [],
      },
      { complete },
    );

    expect(result.body.metadata.size).toBe(0);
  });

  test("an empty draft throws before complete() is called", async () => {
    const { complete, calls } = fakeComplete(minimalTxHex());

    await expect(
      buildDraftTx(
        new MeshTxBuilder({}),
        createDraft("d1"),
        {
        inputs: { kind: "script", scriptCbor: SCRIPT_CBOR },
        walletAddress: WALLET_ADDRESS,
        availableUtxos: [],
      },
        { complete },
      ),
    ).rejects.toThrow("no outputs");
    expect(calls).toEqual([]);
  });

  test("complete() failures propagate to the caller", async () => {
    await expect(
      buildDraftTx(
        new MeshTxBuilder({}),
        sendDraft("2000000"),
        {
        inputs: { kind: "script", scriptCbor: SCRIPT_CBOR },
        walletAddress: WALLET_ADDRESS,
        availableUtxos: [],
      },
        {
          complete: async () => {
            throw new Error("UTxO Balance Insufficient");
          },
        },
      ),
    ).rejects.toThrow("UTxO Balance Insufficient");
  });
});
