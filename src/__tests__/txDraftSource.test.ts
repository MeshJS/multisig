import { MeshTxBuilder, serializeNativeScript, type UTxO } from "@meshsdk/core";

import {
  addOutput,
  addStakeAction,
  addVote,
  createDraft,
  hasMultisigOnlyActions,
  sameSource,
  setSource,
  setUtxoSelection,
} from "@/lib/tx-draft/mutations";
import {
  describeSource,
  resolveSourceAddress,
  sourcePrimaryAction,
  withSourceLabel,
} from "@/lib/tx-draft/source";
import { applyDraftToTxBuilder } from "@/lib/tx-draft/to-tx-builder";
import {
  validateDraft,
  validateSource,
  type DraftIssue,
} from "@/lib/tx-draft/validate";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import type { AddressLabeler } from "@/types/token-flow";
import type { TxDraft } from "@/types/tx-draft";
import {
  DRAFT_SOURCE_NODE_ID,
  draftToTokenFlow,
  flowIdToDraftEntity,
} from "@/utils/token-flow";
import { mockKeyHashes, realTestAddresses } from "./testUtils";

const MULTISIG = realTestAddresses.address1;
const CONNECTED = realTestAddresses.address2;
// CIP-19 test vector — a parseable mainnet payment address.
const MAINNET_ADDRESS =
  "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x";
const TESTNET = { network: 0 };
const SCRIPT_CBOR = "8201828200581c00";

/** A genuine testnet native-script address (payment credential = script). */
const SCRIPT_ADDRESS = serializeNativeScript(
  { type: "sig", keyHash: mockKeyHashes.payment1 },
  undefined,
  0,
).address;

function codes(issues: DraftIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

function utxo(index: number, address: string, lovelace: string): UTxO {
  return {
    input: { txHash: "b".repeat(64), outputIndex: index },
    output: { address, amount: [{ unit: "lovelace", quantity: lovelace }] },
  } as UTxO;
}

function sendDraft(source?: TxDraft["source"]): TxDraft {
  const draft = addOutput(createDraft("d1"), {
    id: "out-1",
    address: CONNECTED,
    assets: [{ unit: "lovelace", quantity: "2000000" }],
  }).draft;
  return source ? { ...draft, source } : draft;
}

function withActions(draft: TxDraft): TxDraft {
  const withCert = addStakeAction(draft, { type: "deregister" }).draft;
  return addVote(withCert, {
    govActionTxHash: "c".repeat(64),
    govActionIndex: 0,
    voteKind: "Yes",
  }).draft;
}

describe("draft source model", () => {
  test("new drafts are funded by the multisig", () => {
    expect(createDraft("d1").source).toEqual({ kind: "multisig" });
  });

  test("sameSource compares kind and address", () => {
    expect(sameSource({ kind: "multisig" }, { kind: "multisig" })).toBe(true);
    expect(sameSource({ kind: "connected" }, { kind: "multisig" })).toBe(false);
    expect(
      sameSource(
        { kind: "address", address: "a" },
        { kind: "address", address: "b" },
      ),
    ).toBe(false);
    expect(
      sameSource(
        { kind: "address", address: "a" },
        { kind: "address", address: "a" },
      ),
    ).toBe(true);
  });

  test("leaving the multisig clears certs and votes and manual picks, keeps outputs", () => {
    const draft = setUtxoSelection(withActions(sendDraft()), {
      mode: "manual",
      utxos: [utxo(0, MULTISIG, "5000000")],
    });
    draft.description = "payroll";
    expect(hasMultisigOnlyActions(draft)).toBe(true);

    const next = setSource(draft, { kind: "connected" });

    expect(next.source).toEqual({ kind: "connected" });
    expect(next.certificates).toEqual([]);
    expect(next.votes).toEqual([]);
    expect(next.utxoSelection).toEqual({ mode: "auto" });
    expect(next.outputs).toEqual(draft.outputs);
    expect(next.description).toBe("payroll");
    // Immutable.
    expect(draft.certificates).toHaveLength(1);
    expect(hasMultisigOnlyActions(next)).toBe(false);
  });

  test("switching between two non-multisig sources keeps nothing multisig-only either", () => {
    const draft = sendDraft({ kind: "address", address: CONNECTED });
    const next = setSource(draft, { kind: "connected" });
    expect(next.utxoSelection).toEqual({ mode: "auto" });
    expect(next.outputs).toHaveLength(1);
  });

  test("re-setting the same source keeps manual picks", () => {
    const draft = setUtxoSelection(sendDraft(), {
      mode: "manual",
      utxos: [utxo(0, MULTISIG, "5000000")],
    });
    expect(setSource(draft, { kind: "multisig" }).utxoSelection).toEqual(
      draft.utxoSelection,
    );
  });
});

describe("source helpers", () => {
  const ctx = { multisigAddress: MULTISIG, connectedAddress: CONNECTED };

  test("resolveSourceAddress", () => {
    expect(resolveSourceAddress({ kind: "multisig" }, ctx)).toBe(MULTISIG);
    expect(resolveSourceAddress({ kind: "connected" }, ctx)).toBe(CONNECTED);
    expect(
      resolveSourceAddress({ kind: "connected" }, { multisigAddress: MULTISIG }),
    ).toBe("");
    expect(
      resolveSourceAddress({ kind: "address", address: ` ${MAINNET_ADDRESS} ` }, ctx),
    ).toBe(MAINNET_ADDRESS);
  });

  test("describeSource and sourcePrimaryAction", () => {
    expect(describeSource({ kind: "multisig" })).toBe("Multisig wallet");
    expect(describeSource({ kind: "connected" }, { walletName: "eternl" })).toBe(
      "Connected wallet (eternl)",
    );
    expect(describeSource({ kind: "connected" })).toBe("Connected wallet");
    expect(describeSource({ kind: "address", address: "x" })).toBe("Other address");

    expect(sourcePrimaryAction({ kind: "multisig" })).toBe("propose");
    expect(sourcePrimaryAction({ kind: "connected" })).toBe("sign");
    expect(sourcePrimaryAction({ kind: "address", address: "" })).toBe("none");
  });

  test("withSourceLabel labels only the source address, as self", () => {
    const base: AddressLabeler = (address) =>
      address === MULTISIG
        ? { label: "Self (Multisig)", type: "self" }
        : { label: "", type: "unknown" };

    const connected = withSourceLabel(base, { kind: "connected" }, CONNECTED, "eternl");
    expect(connected(CONNECTED)).toEqual({
      label: "Connected wallet (eternl)",
      type: "self",
    });
    expect(connected(MULTISIG)).toEqual({ label: "Self (Multisig)", type: "self" });

    const other = withSourceLabel(base, { kind: "address", address: CONNECTED }, CONNECTED);
    expect(other(CONNECTED)).toEqual({ label: "Source address", type: "self" });

    // Multisig source, or no address yet: untouched labeler.
    expect(withSourceLabel(base, { kind: "multisig" }, MULTISIG)).toBe(base);
    expect(withSourceLabel(base, { kind: "connected" }, "")).toBe(base);
  });
});

describe("validateSource", () => {
  const ctx = { ...TESTNET, multisigAddress: MULTISIG, connectedAddress: CONNECTED };

  test("multisig drafts add no source issues", () => {
    expect(validateSource(sendDraft(), ctx)).toEqual([]);
    expect(codes(validateDraft(sendDraft(), ctx))).not.toContain(
      expect.stringMatching(/^source-/),
    );
  });

  test("connected source needs a connected wallet", () => {
    const draft = sendDraft({ kind: "connected" });
    expect(codes(validateSource(draft, { ...ctx, connectedAddress: undefined }))).toEqual([
      "source-address-missing",
    ]);
    expect(validateSource(draft, ctx)).toEqual([]);
  });

  test("address source: missing, invalid, script, wrong network, connected", () => {
    const at = (address: string) => sendDraft({ kind: "address", address });

    expect(codes(validateSource(at(""), ctx))).toEqual(["source-address-missing"]);
    expect(codes(validateSource(at("   "), ctx))).toEqual(["source-address-missing"]);
    expect(codes(validateSource(at("addr_test1garbage"), ctx))).toEqual([
      "source-address-invalid",
    ]);
    expect(codes(validateSource(at(realTestAddresses.invalid), ctx))).toEqual([
      "source-address-invalid",
    ]);

    const script = validateSource(at(SCRIPT_ADDRESS), ctx);
    expect(codes(script)).toEqual(["source-address-script"]);
    expect(script[0]!.message).toMatch(/script address/);

    const own = validateSource(at(MULTISIG), { ...ctx, multisigAddress: SCRIPT_ADDRESS });
    // A key-based multisig fixture isn't a script address; the multisig's own
    // address is flagged through the script check only when it really is one.
    expect(codes(own)).toEqual([]);
    const ownScript = validateSource(at(SCRIPT_ADDRESS), {
      ...ctx,
      multisigAddress: SCRIPT_ADDRESS,
    });
    expect(ownScript[0]!.message).toMatch(/multisig's own address/);

    expect(codes(validateSource(at(MAINNET_ADDRESS), ctx))).toEqual([
      "source-address-wrong-network",
    ]);
    expect(codes(validateSource(at(MAINNET_ADDRESS), { ...ctx, network: 1 }))).toEqual([]);

    const connected = validateSource(at(CONNECTED), ctx);
    expect(connected).toMatchObject([
      { level: "warning", code: "source-address-is-connected" },
    ]);
  });

  test("non-multisig sources can't carry certificates or votes", () => {
    const draft = { ...withActions(sendDraft()), source: { kind: "connected" as const } };
    expect(codes(validateSource(draft, ctx))).toEqual(["source-actions-unsupported"]);
    // validateDraft includes the source issues.
    expect(codes(validateDraft(draft, ctx))).toContain("source-actions-unsupported");
  });
});

describe("applyDraftToTxBuilder with pubkey inputs", () => {
  function body(txBuilder: MeshTxBuilder) {
    (txBuilder as unknown as { queueAllLastItem: () => void }).queueAllLastItem();
    return txBuilder.meshTxBuilderBody;
  }

  test("spends plain key-witnessed inputs and returns change to the source", () => {
    const draft = sendDraft({ kind: "connected" });
    const built = body(
      applyDraftToTxBuilder(new MeshTxBuilder({}), draft, {
        inputs: { kind: "pubkey" },
        walletAddress: CONNECTED,
        availableUtxos: [utxo(0, CONNECTED, "5000000")],
      }),
    );

    expect(built.inputs).toHaveLength(1);
    expect(built.inputs[0]!.type).toBe("PubKey");
    expect(built.inputs[0]!.txIn.address).toBe(CONNECTED);
    expect(built.changeAddress).toBe(CONNECTED);
  });

  test("script inputs still get the script witness", () => {
    const built = body(
      applyDraftToTxBuilder(new MeshTxBuilder({}), sendDraft(), {
        inputs: { kind: "script", scriptCbor: SCRIPT_CBOR },
        walletAddress: MULTISIG,
        availableUtxos: [utxo(0, MULTISIG, "5000000")],
      }),
    );
    expect(built.inputs[0]!.type).not.toBe("PubKey");
  });

  test("pubkey inputs refuse certificates and votes", () => {
    const draft = { ...withActions(sendDraft()), source: { kind: "connected" as const } };
    expect(() =>
      applyDraftToTxBuilder(new MeshTxBuilder({}), draft, {
        inputs: { kind: "pubkey" },
        walletAddress: CONNECTED,
        availableUtxos: [utxo(0, CONNECTED, "9000000")],
      }),
    ).toThrow(/only be built from the multisig/);
  });
});

describe("draftToTokenFlow source card", () => {
  const labelAddress: AddressLabeler = () => ({ label: "", type: "unknown" });

  test("attaches the auto input and change to whatever the source address is", () => {
    const flow = draftToTokenFlow(sendDraft({ kind: "connected" }), {
      labelAddress,
      walletAddress: CONNECTED,
    });
    expect(flow.edges.find((e) => e.kind === "input")).toMatchObject({
      source: `addr:${CONNECTED}`,
    });
    expect(flow.edges.find((e) => e.note === "change")).toMatchObject({
      target: `addr:${CONNECTED}`,
    });
  });

  test("renders a placeholder source card while the address is unknown", () => {
    const flow = draftToTokenFlow(sendDraft({ kind: "address", address: "" }), {
      labelAddress,
      walletAddress: "",
    });
    const placeholder = flow.nodes.find((n) => n.id === DRAFT_SOURCE_NODE_ID);
    expect(placeholder).toMatchObject({
      kind: "address",
      address: "",
      label: "Set source address",
      partyType: "self",
    });
    expect(flow.edges.find((e) => e.kind === "input")).toMatchObject({
      source: DRAFT_SOURCE_NODE_ID,
      note: "auto selection",
    });
    expect(flow.edges.find((e) => e.note === "change")).toMatchObject({
      target: DRAFT_SOURCE_NODE_ID,
    });
    expect(flowIdToDraftEntity(sendDraft(), DRAFT_SOURCE_NODE_ID)).toEqual({
      kind: "tx",
    });
    expect(flowIdToDraftEntity(sendDraft(), `${DRAFT_SOURCE_NODE_ID}@in`)).toEqual({
      kind: "tx",
    });
  });
});

describe("tx-builder store setSource", () => {
  beforeEach(() => useTxBuilderStore.getState().resetDraft("w1"));

  test("applies the source and is a no-op while editing a pending tx", () => {
    const store = useTxBuilderStore.getState();
    store.setSource({ kind: "connected" });
    expect(useTxBuilderStore.getState().draft.source).toEqual({ kind: "connected" });

    useTxBuilderStore.getState().loadDraft({
      walletId: "w1",
      draft: createDraft("loaded"),
      editingTxId: "tx-1",
    });
    expect(useTxBuilderStore.getState().draft.source).toEqual({ kind: "multisig" });
    useTxBuilderStore.getState().setSource({ kind: "connected" });
    expect(useTxBuilderStore.getState().draft.source).toEqual({ kind: "multisig" });

    useTxBuilderStore.getState().cancelEditing();
    useTxBuilderStore.getState().setSource({ kind: "address", address: "addr_x" });
    expect(useTxBuilderStore.getState().draft.source).toEqual({
      kind: "address",
      address: "addr_x",
    });
  });

  test("resetDraft returns to the multisig source", () => {
    useTxBuilderStore.getState().setSource({ kind: "connected" });
    useTxBuilderStore.getState().resetDraft("w1");
    expect(useTxBuilderStore.getState().draft.source).toEqual({ kind: "multisig" });
  });
});
