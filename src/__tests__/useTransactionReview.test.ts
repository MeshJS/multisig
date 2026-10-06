import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MeshTxBuilder } from "@meshsdk/core";
import useTransaction from "@/hooks/useTransaction";

const mockSign = jest.fn().mockResolvedValue("wallet-witnesses");
const mockCreate = jest.fn().mockResolvedValue({});
const mockComplete = jest.fn().mockResolvedValue("completed-unsigned-tx");
const mockPaymentWitness = jest.fn().mockReturnValue(true);
const mockReadiness = jest.fn().mockResolvedValue({ ready: false, missingKeyHashes: [] });
jest.mock("@/utils/transactionReadiness", () => ({
  hasVerifiedPaymentWitness: (...args: unknown[]) => mockPaymentWitness(...args),
  transactionReadiness: (...args: unknown[]) => mockReadiness(...args),
}));

jest.mock("@/utils/api", () => ({
  api: {
    useUtils: () => ({}),
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
    activeWallet: { signTx: mockSign },
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
  let result!: ReturnType<typeof useTransaction>;
  function Harness() {
    result = useTransaction();
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return result;
}

const builder = () =>
  ({ meshTxBuilderBody: { outputs: [] } }) as unknown as MeshTxBuilder;

describe("finalized transaction review before signing", () => {
  beforeEach(() => { jest.clearAllMocks(); mockPaymentWitness.mockReturnValue(true); });

  test("a missing authorized payment witness cannot mark the proposer signed", async () => {
    mockPaymentWitness.mockReturnValue(false);
    await expect(hook().newTransaction({ txBuilder: builder() })).rejects.toThrow(/authorized payment key/);
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
});
