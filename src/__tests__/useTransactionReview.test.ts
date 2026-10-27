import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MeshTxBuilder } from "@meshsdk/core";
import useTransaction from "@/hooks/useTransaction";
import useSignAndSubmit from "@/hooks/useSignAndSubmit";
import { resolveTxHash } from "@meshsdk/core-cst";
import type { DraftBuildResult } from "@/lib/tx-draft/build-draft-tx";
import { reviewBuiltTransaction } from "@/lib/tx-risk/review";
import { resolveTransactionRisks } from "@/lib/tx-risk/transaction";
import {
  collateral,
  ctx,
  scriptInput,
  contractReviewTransaction,
} from "./fixtures/tx-risk";

const mockSign = jest.fn().mockResolvedValue("wallet-witnesses");
const mockCreate = jest.fn().mockResolvedValue({});
const mockSubmit = jest.fn().mockResolvedValue("tx-hash");
const mockComplete = jest.fn().mockResolvedValue("completed-unsigned-tx");
const mockPaymentWitness = jest.fn().mockReturnValue(true);
const mockReadiness = jest
  .fn()
  .mockResolvedValue({ ready: false, missingKeyHashes: [] });
// Proxy auth-token audit consulted right before the wallet signs; a clean
// result lets the flow proceed, a message refuses it before signTx.
const mockPreSignAudit = jest.fn().mockResolvedValue({ error: null });
jest.mock("@/utils/transactionReadiness", () => ({
  hasVerifiedPaymentWitness: (...args: unknown[]) =>
    mockPaymentWitness(...args),
  transactionReadiness: (...args: unknown[]) => mockReadiness(...args),
}));

jest.mock("@/utils/api", () => ({
  api: {
    useUtils: () => ({
      transaction: {
        preSignProxyAudit: {
          fetch: (...args: unknown[]) => mockPreSignAudit(...args),
        },
      },
    }),
    transaction: {
      createTransaction: { useMutation: () => ({ mutateAsync: mockCreate }) },
    },
  },
}));
jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));
jest.mock("@/hooks/useAppWallet", () => ({
  __esModule: true,
  default: () => ({ appWallet: { id: "wallet" } }),
}));
jest.mock("@/hooks/useActiveWallet", () => ({
  __esModule: true,
  default: () => ({
    userAddress: "signer",
    activeWallet: { signTx: mockSign, submitTx: mockSubmit },
  }),
}));
jest.mock("@/lib/zustand/site", () => ({
  useSiteStore: (select: (state: unknown) => unknown) =>
    select({ network: 0, setLoading: jest.fn() }),
}));
jest.mock("@/lib/completeTxWithFreshCostModels", () => ({
  completeTxWithFreshCostModels: (...args: unknown[]) => mockComplete(...args),
}));
jest.mock("@/utils/get-provider", () => ({ getProvider: jest.fn() }));
jest.mock("@/utils/txSignUtils", () => ({
  mergeSignerWitnesses: () => ({
    txHex: "signed-tx",
    invalidVkeyPubKeysHex: [],
  }),
  filterWitnessesToScripts: (hex: string) => hex,
  shouldSubmitMultisigTx: () => false,
}));

function hook() {
  let result!: ReturnType<typeof useTransaction> &
    ReturnType<typeof useSignAndSubmit>;
  function Harness() {
    result = { ...useTransaction(), ...useSignAndSubmit() };
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return result;
}

const builder = () =>
  ({ meshTxBuilderBody: { outputs: [] } }) as unknown as MeshTxBuilder;

describe("finalized transaction review before signing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPaymentWitness.mockReturnValue(true);
    mockReadiness.mockResolvedValue({ ready: false, missingKeyHashes: [] });
    mockSign.mockResolvedValue("wallet-witnesses");
    mockPreSignAudit.mockResolvedValue({ error: null });
  });

  test("a failed proxy auth-token audit refuses the transaction before the wallet signs", async () => {
    mockPreSignAudit.mockResolvedValue({
      error: "token would leave the wallet",
    });
    await hook().newTransaction({ txBuilder: builder() });
    expect(mockPreSignAudit).toHaveBeenCalledWith({
      walletId: "wallet",
      txCbor: "completed-unsigned-tx",
    });
    expect(mockSign).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  describe.each(["proposal", "replacement", "connected", "export"])(
    "%s action boundary",
    (action) => {
      test.each([
        "unchanged",
        "spent input",
        "spent collateral",
        "provider failure",
      ])("final refresh: %s", async (outcome) => {
        const txBuilder = builder();
        txBuilder.meshTxBuilderBody.requiredSignatures = [];
        const unsignedTx = contractReviewTransaction();
        const result = {
          unsignedTx,
          txHash: resolveTxHash(unsignedTx),
          body: txBuilder.meshTxBuilderBody,
        } as DraftBuildResult;
        const provider = {
          fetchUTxOs: jest.fn(async () => [scriptInput, collateral]),
          fetchAddressUTxOs: jest.fn(async () => [scriptInput, collateral]),
        };
        const clipboard = jest.fn();
        const refresh = jest.fn((hex: string) =>
          resolveTransactionRisks(hex, ctx, provider),
        );
        const review = () =>
          reviewBuiltTransaction(result, {
            network: 0,
            isCurrent: () => true,
            refresh,
            confirm: async () => {
              if (action === "proposal" || action === "replacement")
                expect(mockPreSignAudit).toHaveBeenCalledTimes(1);
              if (outcome === "spent input")
                provider.fetchAddressUTxOs.mockResolvedValue([collateral]);
              if (outcome === "spent collateral")
                provider.fetchAddressUTxOs.mockResolvedValue([scriptInput]);
              if (outcome === "provider failure")
                provider.fetchUTxOs.mockRejectedValue(new Error("offline"));
              return { accepted: true, acknowledged: true };
            },
          });
        const actions = hook();
        const run = async () => {
          if (action === "connected" || action === "export") {
            if (await review()) {
              if (action === "export") clipboard(unsignedTx);
              else {
                mockReadiness.mockResolvedValue({ ready: true });
                await actions.signAndSubmit(unsignedTx);
              }
            }
          } else {
            await actions.newTransaction({
              txBuilder,
              completed: result,
              beforeSign: review,
              replaces:
                action === "replacement"
                  ? { transactionId: "old", knownSignedCount: 1 }
                  : undefined,
            });
          }
        };
        if (outcome === "unchanged") {
          await run();
          if (action === "export")
            expect(clipboard).toHaveBeenCalledWith(unsignedTx);
          else
            expect(mockSign).toHaveBeenCalledWith(
              unsignedTx,
              ...(action === "connected" ? [] : [true]),
            );
        } else {
          await expect(run()).rejects.toThrow(/facts changed/);
          expect(mockSign).not.toHaveBeenCalled();
          expect(mockSubmit).not.toHaveBeenCalled();
          expect(mockCreate).not.toHaveBeenCalled();
          expect(clipboard).not.toHaveBeenCalled();
        }
        expect(refresh.mock.calls).toEqual([[unsignedTx], [unsignedTx]]);
        expect(mockComplete).not.toHaveBeenCalled();
      });
    },
  );

  test("a missing authorized payment witness cannot mark the proposer signed", async () => {
    mockPaymentWitness.mockReturnValue(false);
    await expect(
      hook().newTransaction({ txBuilder: builder() }),
    ).rejects.toThrow(/authorized payment key/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("cancelling review never asks for a signature or creates a pending transaction", async () => {
    const beforeSign = jest.fn().mockResolvedValue(false);
    const result = await hook().newTransaction({
      txBuilder: builder(),
      beforeSign,
    });
    expect(beforeSign).toHaveBeenCalledWith("completed-unsigned-tx");
    expect(result).toBe(false);
    expect(mockSign).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("waits for acceptance and signs the exact reviewed completion once", async () => {
    let accept!: (value: boolean) => void;
    const waiting = new Promise<boolean>((resolve) => {
      accept = resolve;
    });
    let reviewed!: () => void;
    const reachedReview = new Promise<void>((resolve) => {
      reviewed = resolve;
    });
    const txBuilder = builder();
    const extras = jest
      .fn()
      .mockReturnValue({ builderOutputs: { version: 1, outputs: [] } });
    const task = hook().newTransaction({
      txBuilder,
      txJsonExtras: extras,
      beforeSign: async (unsignedTx) => {
        expect(unsignedTx).toBe("completed-unsigned-tx");
        reviewed();
        return waiting;
      },
    });
    await reachedReview;
    expect(mockSign).not.toHaveBeenCalled();
    accept(true);
    await task;
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockSign).toHaveBeenCalledWith("completed-unsigned-tx", true);
    expect(extras).toHaveBeenCalledWith(txBuilder.meshTxBuilderBody);
    expect(JSON.parse(mockCreate.mock.calls[0]![0].txJson)).toMatchObject({
      builderOutputs: { version: 1 },
    });
  });

  test("a prepared proposal signs the evaluated bytes without recompletion and persists their body", async () => {
    const txBuilder = builder();
    const body = { ...txBuilder.meshTxBuilderBody, fee: "222222" };
    await hook().newTransaction({
      txBuilder,
      completed: { unsignedTx: "evaluated-bytes", body },
      beforeSign: async (hex) => hex === "evaluated-bytes",
    });
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockSign).toHaveBeenCalledWith("evaluated-bytes", true);
    expect(JSON.parse(mockCreate.mock.calls[0]![0].txJson).fee).toBe("222222");
  });

  test("completed bytes cannot receive new metadata after review", async () => {
    const txBuilder = builder();
    await expect(
      hook().newTransaction({
        txBuilder,
        completed: {
          unsignedTx: "evaluated-bytes",
          body: txBuilder.meshTxBuilderBody,
        },
        metadataValue: { label: "674", value: "changed" },
      }),
    ).rejects.toThrow(/before completing/);
    expect(mockSign).not.toHaveBeenCalled();
  });

  test("replacing a partially signed pending transaction persists only the new signer and reviewed body", async () => {
    const txBuilder = builder();
    const body = {
      ...txBuilder.meshTxBuilderBody,
      requiredSignatures: ["a".repeat(56)],
      fee: "222222",
    };
    const replaces = {
      transactionId: "partially-signed-original",
      knownSignedCount: 2,
    };
    await hook().newTransaction({
      txBuilder,
      completed: { unsignedTx: "rebuilt-evaluated-bytes", body },
      replaces,
      beforeSign: async () => true,
      txJsonExtras: { builderOutputs: { version: 1, outputs: [] } },
    });
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockSign).toHaveBeenCalledWith("rebuilt-evaluated-bytes", true);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        replaces,
        signedAddresses: ["signer"],
        state: 0,
        txCbor: "signed-tx",
      }),
    );
    expect(JSON.parse(mockCreate.mock.calls[0]![0].txJson)).toMatchObject({
      requiredSignatures: body.requiredSignatures,
      builderOutputs: { version: 1 },
    });
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  test.each(["review", "proxy audit", "wallet", "readiness"])(
    "a draft/account change during %s prevents proposal persistence",
    async (stage) => {
      let current = true;
      const txBuilder = builder();
      if (stage === "proxy audit")
        mockPreSignAudit.mockImplementation(async () => {
          current = false;
          return { error: null };
        });
      if (stage === "wallet")
        mockSign.mockImplementation(async () => {
          current = false;
          return "wallet-witnesses";
        });
      if (stage === "readiness")
        mockReadiness.mockImplementation(async () => {
          current = false;
          return { ready: true };
        });
      await expect(
        hook().newTransaction({
          txBuilder,
          completed: {
            unsignedTx: "evaluated-bytes",
            body: txBuilder.meshTxBuilderBody,
          },
          isCurrent: () => current,
          beforeSign: async () => {
            if (stage === "review") current = false;
            return true;
          },
        }),
      ).rejects.toThrow(/superseded/);
      expect(mockCreate).not.toHaveBeenCalled();
      if (stage === "review" || stage === "proxy audit")
        expect(mockSign).not.toHaveBeenCalled();
    },
  );

  test("direct signing submits only the reviewed bytes with all required signatures", async () => {
    mockReadiness.mockResolvedValue({ ready: true });
    await hook().signAndSubmit("evaluated-bytes");
    expect(mockSign).toHaveBeenCalledWith("evaluated-bytes");
    expect(mockSubmit).toHaveBeenCalledWith("signed-tx");
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test.each(["wallet", "readiness"])(
    "an account change during direct %s cannot submit",
    async (stage) => {
      let current = true;
      if (stage === "wallet")
        mockSign.mockImplementation(async () => {
          current = false;
          return "wallet-witnesses";
        });
      if (stage === "readiness")
        mockReadiness.mockImplementation(async () => {
          current = false;
          return { ready: true };
        });
      await expect(
        hook().signAndSubmit("evaluated-bytes", () => current),
      ).rejects.toThrow(/superseded/);
      expect(mockSubmit).not.toHaveBeenCalled();
    },
  );
});
