import { MeshTxBuilder, type IFetcher } from "@meshsdk/core";
import { resolveTxHash } from "@meshsdk/core-cst";
import {
  buildDraftTx,
  type DraftBuildResult,
} from "@/lib/tx-draft/build-draft-tx";
import { addOutput, createDraft } from "@/lib/tx-draft/mutations";
import {
  assessTransactionRisks,
  resolveTransactionRisks,
} from "@/lib/tx-risk/transaction";
import { reviewBuiltTransaction } from "@/lib/tx-risk/review";
import { draftToTokenFlow } from "@/utils/token-flow/from-draft";
import { assessDraftOutputRisks } from "@/lib/tx-risk/assessment";
import {
  address,
  ctx,
  funding,
  native,
  output,
  transaction,
} from "./fixtures/tx-risk";
import { createMockProvider } from "./tx-builders/mockProvider";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import { knownPlutusGap } from "./fixtures/known-plutus-gap";

function built(destination = address("known")): DraftBuildResult {
  const unsignedTx = transaction({ outputs: [output(destination)] });
  return {
    unsignedTx,
    txHash: resolveTxHash(unsignedTx),
    fee: "200000",
    sizeBytes: unsignedTx.length / 2,
    inputCount: 1,
    outputCount: 1,
    body: new MeshTxBuilder().meshTxBuilderBody,
    riskAssessment: assessTransactionRisks(unsignedTx, ctx, {
      utxos: [funding],
    }),
    outputReview: [
      {
        id: "one",
        address: destination,
        requestedLovelace: "5000000",
        actualLovelace: "5000000",
      },
    ],
  };
}

describe("builder action risk gate", () => {
  describe.each(["spent input", "provider unavailable"])(
    "G4: %s during confirmation",
    (failure) => {
      let action: jest.Mock;
      let refresh: jest.Mock;
      let accepted: boolean;
      beforeEach(async () => {
        const result = built();
        const provider = {
          fetchUTxOs: jest.fn(async () => [funding]),
          fetchAddressUTxOs: jest.fn(async () => [funding]),
        };
        refresh = jest.fn(() =>
          resolveTransactionRisks(result.unsignedTx, ctx, provider),
        );
        expect((await refresh()).status).toBe("complete");
        refresh.mockClear();
        action = jest.fn();
        accepted = await reviewBuiltTransaction(result, {
          network: 0,
          isCurrent: () => true,
          refresh,
          confirm: async () => {
            if (failure === "spent input")
              provider.fetchAddressUTxOs.mockResolvedValue([]);
            else
              provider.fetchUTxOs.mockRejectedValue(
                new Error("provider offline"),
              );
            return { accepted: true, acknowledged: true };
          },
        });
        if (accepted) action();
        // Prove the changed provider state actually yields an incomplete review.
        expect(
          (await resolveTransactionRisks(result.unsignedTx, ctx, provider))
            .status,
        ).toBe("incomplete");
      });

      knownPlutusGap(
        "G4: refuses the action after mandatory chain facts become unavailable",
        () => {
          // Convert to test() in phase 4; setup and resolver assertions remain normal failures.
          expect({ accepted, actions: action.mock.calls.length }).toEqual({
            accepted: false,
            actions: 0,
          });
        },
      );
    },
  );
  test.each([
    "multisig proposal",
    "connected signing",
    "replacement",
    "unsigned export",
  ])("%s requires explicit acknowledgment of a dangerous output", async () => {
    const result = built();
    const action = jest.fn();
    const opts = {
      network: 0,
      isCurrent: () => true,
      refresh: async () => result.riskAssessment!,
      confirm: jest.fn(async () => ({ accepted: true, acknowledged: false })),
    };
    if (await reviewBuiltTransaction(result, opts)) action();
    expect(action).not.toHaveBeenCalled();
    opts.confirm.mockResolvedValue({ accepted: true, acknowledged: true });
    if (await reviewBuiltTransaction(result, opts)) action();
    expect(action).toHaveBeenCalledTimes(1);
    expect(opts.confirm).toHaveBeenCalledTimes(2);
  });

  test("cancelling and stale draft/account/network contexts never authorize an action", async () => {
    const result = built();
    let current = true;
    const opts = {
      network: 0,
      isCurrent: () => current,
      refresh: async () => result.riskAssessment!,
      confirm: jest.fn(async () => ({ accepted: false, acknowledged: true })),
    };
    expect(await reviewBuiltTransaction(result, opts)).toBe(false);
    opts.confirm.mockImplementation(async () => {
      current = false;
      return { accepted: true, acknowledged: true };
    });
    expect(await reviewBuiltTransaction(result, opts)).toBe(false);
    opts.confirm.mockClear();
    expect(await reviewBuiltTransaction(result, opts)).toBe(false);
    expect(opts.confirm).not.toHaveBeenCalled();
  });

  test("incomplete, wrong-network, wrong-version and mismatched-hash assessments cannot be accepted", async () => {
    const result = built();
    for (const changed of [
      { ...result.riskAssessment!, status: "incomplete" as const },
      { ...result.riskAssessment!, networkId: 1 },
      { ...result.riskAssessment!, version: 99 as 1 },
      { ...result.riskAssessment!, txHash: "00".repeat(32) },
    ]) {
      expect(
        await reviewBuiltTransaction(result, {
          network: 0,
          isCurrent: () => true,
          refresh: async () => changed,
          confirm: async () => ({ accepted: true, acknowledged: true }),
        }),
      ).toBe(false);
    }
  });

  test("newly discovered risk is reviewed even if the previous build had no warnings", async () => {
    const result = built();
    const fresh = result.riskAssessment!;
    result.riskAssessment = { ...fresh, findings: [] };
    const confirm = jest.fn(async () => ({
      accepted: false,
      acknowledged: false,
    }));
    expect(
      await reviewBuiltTransaction(result, {
        network: 0,
        isCurrent: () => true,
        refresh: async () => fresh,
        confirm,
      }),
    ).toBe(false);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ riskAssessment: fresh }),
    );
  });

  test("ordinary key transfers skip a dialog, while unknown scripts require review without extra acknowledgment", async () => {
    for (const kind of ["key", "unknown"] as const) {
      const result = built(address(kind));
      const confirm = jest.fn(async (_result: DraftBuildResult) => ({
        accepted: true,
        acknowledged: false,
      }));
      expect(
        await reviewBuiltTransaction(result, {
          network: 0,
          isCurrent: () => true,
          refresh: async () => result.riskAssessment!,
          confirm,
        }),
      ).toBe(true);
      expect(confirm).toHaveBeenCalledTimes(kind === "key" ? 0 : 1);
    }
  });

  test("changing bytes or assessment while the dialog is open invalidates its decision", async () => {
    const result = built();
    expect(
      await reviewBuiltTransaction(result, {
        network: 0,
        isCurrent: () => true,
        refresh: async () => result.riskAssessment!,
        confirm: async (reviewed) => {
          reviewed.riskAssessment!.findings = [];
          return { accepted: true, acknowledged: true };
        },
      }),
    ).toBe(false);
    const bad = built();
    bad.unsignedTx = transaction({ outputs: [output(address("key"))] });
    await expect(
      reviewBuiltTransaction(bad, {
        network: 0,
        isCurrent: () => true,
        refresh: async () => bad.riskAssessment!,
        confirm: async () => ({ accepted: true, acknowledged: true }),
      }),
    ).rejects.toThrow("Transaction changed");
  });
});

test("real completion attaches CBOR-derived risks and final amounts; missing live inputs leave a correction state", async () => {
  const draft = addOutput(createDraft("risk"), {
    id: "recipient",
    address: address("known"),
    assets: [{ unit: "lovelace", quantity: "1" }],
    inlineDatum: { format: "CBOR", text: "01" },
  }).draft;
  const provider = createMockProvider({ utxos: [funding] });
  const build = () =>
    buildDraftTx(
      new MeshTxBuilder({ fetcher: provider as unknown as IFetcher }),
      draft,
      {
        inputs: { kind: "script", scriptCbor: native.to_hex() },
        walletAddress: address("own"),
        availableUtxos: [funding],
      },
      { complete: (b) => b.complete(), risk: { context: ctx, provider } },
    );
  const result = await build();
  expect(result.riskAssessment).toMatchObject({
    status: "complete",
    txHash: result.txHash,
  });
  expect(result.riskAssessment?.findings).toHaveLength(1);
  expect(
    BigInt(result.riskAssessment!.findings[0]!.assets[0]!.quantity),
  ).toBeGreaterThan(1n);
  expect(result.outputReview?.[0]?.assets).toEqual(
    result.riskAssessment?.outputs[0]?.assets,
  );
  provider.fetchAddressUTxOs.mockResolvedValue([]);
  expect((await build()).riskAssessment?.status).toBe("incomplete");
});

test("canvas warning indicators stay attached to duplicate recipient IDs", () => {
  let draft = addOutput(createDraft("risk"), {
    id: "one",
    address: address("known"),
    assets: [],
  }).draft;
  draft = addOutput(draft, {
    id: "two",
    address: address("known"),
    assets: [],
  }).draft;
  const findings = assessDraftOutputRisks(draft, ctx).findings;
  const flow = draftToTokenFlow(draft, {
    walletAddress: address("own"),
    labelAddress: () => ({ label: "Contact", type: "contact" }),
    riskFindings: findings,
  });
  for (const id of ["one", "two"])
    expect(
      flow.nodes.find((node) => node.id === `draftout:${id}`),
    ).toMatchObject({ details: ["Warning: anyone can spend"] });
});

describe("store edits invalidate an outstanding real-CBOR review", () => {
  test.each([
    "address",
    "amount",
    "datum",
    "redeemer",
    "collateral",
    "source",
    "account",
    "network",
    "replacement",
  ])("%s cannot reuse acceptance", async (change) => {
    const store = useTxBuilderStore;
    store.getState().resetDraft("risk-wallet");
    store.getState().syncEnvironment({ network: 0, account: "signer-a" });
    const id = store.getState().addOutput({
      address: address("known"),
      assets: [{ unit: "lovelace", quantity: "5000000" }],
    });
    const inputId = store.getState().addScriptInput();
    const captured = store.getState().draft;
    const result = built();
    const action = jest.fn();
    const accepted = await reviewBuiltTransaction(result, {
      network: 0,
      isCurrent: () => store.getState().draft === captured,
      refresh: async () => result.riskAssessment!,
      confirm: async () => {
        const state = store.getState();
        switch (change) {
          case "address":
            state.updateOutput(id, { address: address("key") });
            break;
          case "amount":
            state.setOutputAsset(id, "lovelace", "6000000");
            break;
          case "datum":
            state.setOutputDatum(id, { format: "CBOR", text: "01" });
            break;
          case "redeemer":
            state.updateScriptInput(inputId, {
              redeemer: { format: "CBOR", text: "02" },
            });
            break;
          case "collateral":
            state.setCollateral({
              utxoRef: { txHash: "cc".repeat(32), outputIndex: 0 },
            });
            break;
          case "source":
            state.setSource({ kind: "connected" });
            break;
          case "account":
            state.syncEnvironment({ network: 0, account: "signer-b" });
            break;
          case "network":
            state.syncEnvironment({ network: 1, account: "signer-a" });
            break;
          case "replacement":
            state.loadDraft({
              walletId: "risk-wallet",
              editingTxId: "replacement",
              draft: captured,
            });
            break;
        }
        return { accepted: true, acknowledged: true };
      },
    });
    if (accepted) action();
    expect(accepted).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });
});
