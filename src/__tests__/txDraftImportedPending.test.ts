import { csl } from "@meshsdk/core-csl";
import { resolveTxHash } from "@meshsdk/core-cst";
import { transactionRouter } from "@/server/api/routers/transactions";
import { MeshTxBuilder, type UTxO } from "@meshsdk/core";
import { resolvePendingTransaction } from "@/lib/tx-draft/reconstruct-pending";
import { buildDraftTx } from "@/lib/tx-draft/build-draft-tx";
import { output, transaction } from "./fixtures/tx-risk";

// Exercise the actual importer, auth and codecs. Only external services and the
// database are replaced; no network, database connection or broadcast is used.
jest.mock("superjson", () => ({
  __esModule: true,
  default: {
    serialize: (value: unknown) => value,
    deserialize: (value: unknown) => value,
  },
}));
jest.mock("@/server/auth", () => ({ getServerAuthSession: jest.fn() }));
jest.mock("@/server/db", () => ({ db: {} }));
jest.mock("@/lib/observability/audit", () => ({ audit: jest.fn() }));
jest.mock("@/lib/notifications/center", () => ({
  enqueueSignatureRequiredNotifications: jest.fn(),
  enqueueThresholdReachedNotifications: jest.fn(),
}));
jest.mock("@/lib/task-payout/sync", () => ({
  cancelPayoutsForTransaction: jest.fn(),
  markPayoutsPaid: jest.fn(),
}));
jest.mock("@/utils/get-provider", () => ({
  getProvider: () => ({ get: mockChainRead }),
}));

const key = csl.PrivateKey.generate_ed25519();
const signer = csl.EnterpriseAddress.new(
  0,
  csl.Credential.from_keyhash(key.to_public().hash()),
)
  .to_address()
  .to_bech32();
const members = csl.NativeScripts.new();
members.add(
  csl.NativeScript.new_script_pubkey(
    csl.ScriptPubkey.new(key.to_public().hash()),
  ),
);
const native = csl.NativeScript.new_script_all(csl.ScriptAll.new(members));
const walletAddress = csl.EnterpriseAddress.new(
  0,
  csl.Credential.from_scripthash(native.hash()),
)
  .to_address()
  .to_bech32();
const mockChainRead = jest.fn(async () => ({
  outputs: [
    {
      output_index: 0,
      address: walletAddress,
      amount: [{ unit: "lovelace", quantity: "10000000" }],
    },
  ],
}));
const wallet = {
  id: "import-wallet",
  name: "Import fixture",
  type: "all",
  numRequiredSigners: 1,
  signersAddresses: [signer],
  signersDescriptions: [],
  signersStakeKeys: [],
  signersDRepKeys: [],
  scriptCbor: native.to_hex(),
  ownerAddress: signer,
};

describe("G2: importer to editor integration", () => {
  let row: { txCbor: string; txJson: string };
  let original: string;
  beforeEach(async () => {
    const unsigned = transaction({ outputs: [output(signer, "9800000")] });
    const tx = csl.Transaction.from_hex(unsigned);
    const witnesses = tx.witness_set();
    const scripts = csl.NativeScripts.new();
    scripts.add(native);
    witnesses.set_native_scripts(scripts);
    const vkeys = csl.Vkeywitnesses.new();
    vkeys.add(
      csl.Vkeywitness.new(
        csl.Vkey.new(key.to_public()),
        key.sign(Buffer.from(resolveTxHash(unsigned), "hex")),
      ),
    );
    witnesses.set_vkeys(vkeys);
    original = csl.Transaction.new(tx.body(), witnesses).to_hex();
    const create = jest.fn(async ({ data }) => ({ id: "imported", ...data }));
    const db = {
      wallet: { findUnique: jest.fn(async () => wallet) },
      transaction: { create },
      proxy: { findMany: jest.fn(async () => []) },
    };
    const caller = transactionRouter.createCaller({
      db,
      session: null,
      sessionAddress: signer,
      sessionWallets: [signer],
      primaryWallet: signer,
      ip: "127.0.0.1",
    } as unknown as Parameters<typeof transactionRouter.createCaller>[0]);
    row = await caller.importTransaction({
      walletId: wallet.id,
      txCbor: original,
    });
    // Import/fixture errors must fail outside the expected-failure assertion.
    expect(create).toHaveBeenCalledTimes(1);
    expect(row.txCbor).toBe(original);
    const body = JSON.parse(row.txJson);
    expect(body.outputs).toEqual([
      { address: signer, amount: [{ unit: "lovelace", quantity: "9800000" }] },
    ]);
    expect(body.inputs[0].txIn.address).toBe(walletAddress);
  });

  test("retains the original signed CBOR alongside the endpoint's JSON", () => {
    expect(resolveTxHash(row.txCbor)).toBe(resolveTxHash(original));
    expect(
      csl.Transaction.from_hex(row.txCbor).witness_set().vkeys()?.len(),
    ).toBe(1);
  });

  test("G2: an ordinary transfer produced by importTransaction remains editable", async () => {
    const input = JSON.parse(row.txJson).inputs[0].txIn;
    expect(JSON.parse(row.txJson).inputs[0].type).toBeUndefined();
    const funding: UTxO = {
      input: { txHash: input.txHash, outputIndex: input.txIndex },
      output: { address: walletAddress, amount: input.amount },
    };
    const result = await resolvePendingTransaction(
      row,
      {
        network: 0,
        walletNativeScript: { address: walletAddress, cbor: native.to_hex() },
      },
      {
        fetchUTxOs: async () => [funding],
        fetchAddressUTxOs: async () => [funding],
      },
    );
    expect(result.compatible).toBe(true);
    if (!result.compatible) throw new Error(result.reasons.join("; "));
    const draft = result.reconstruction.draft;
    expect(result.reconstruction.warnings).toEqual(["change-not-detected"]);
    expect(draft.outputs[0]!.assets[0]!.quantity).toBe("9800000");
    draft.outputs[0]!.assets[0]!.quantity = "8000000";
    const rebuilt = await buildDraftTx(
      new MeshTxBuilder({}),
      draft,
      {
        inputs: { kind: "script", scriptCbor: native.to_hex() },
        walletAddress,
        availableUtxos: [funding],
      },
      { complete: (builder) => builder.complete() },
    );
    expect(rebuilt.txHash).not.toBe(resolveTxHash(original));
    expect(
      csl.Transaction.from_hex(rebuilt.unsignedTx)
        .witness_set()
        .vkeys()
        ?.len() ?? 0,
    ).toBe(0);
    expect(
      csl.Transaction.from_hex(rebuilt.unsignedTx)
        .body()
        .outputs()
        .get(0)
        .amount()
        .coin()
        .to_str(),
    ).toBe("8000000");

    const create = jest.fn(async ({ data }) => ({
      id: "replacement",
      ...data,
    }));
    const remove = jest.fn();
    const old = {
      id: "imported",
      walletId: wallet.id,
      state: 0,
      signedAddresses: [signer],
    };
    const transaction = {
      findUnique: jest.fn(async () => old),
      create,
      delete: remove,
    };
    const db = {
      wallet: { findUnique: jest.fn(async () => wallet) },
      transaction,
      proxy: { findMany: jest.fn(async () => []) },
      $transaction: async (fn: (db: unknown) => unknown) => fn({ transaction }),
    };
    const caller = transactionRouter.createCaller({
      db,
      session: null,
      sessionAddress: signer,
      sessionWallets: [signer],
      primaryWallet: signer,
    } as unknown as Parameters<typeof transactionRouter.createCaller>[0]);
    const replacement = {
      walletId: wallet.id,
      txJson: JSON.stringify(rebuilt.body),
      txCbor: rebuilt.unsignedTx,
      signedAddresses: [],
      state: 0,
      replaces: { transactionId: old.id, knownSignedCount: 0 },
    };
    await expect(caller.createTransaction(replacement)).rejects.toThrow(
      /New signatures/,
    );
    expect(remove).not.toHaveBeenCalled();
    await caller.createTransaction({
      ...replacement,
      replaces: { ...replacement.replaces, knownSignedCount: 1 },
    });
    expect(remove).toHaveBeenCalledWith({ where: { id: "imported" } });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        txCbor: rebuilt.unsignedTx,
        signedAddresses: [],
      }),
    });
  });
});
