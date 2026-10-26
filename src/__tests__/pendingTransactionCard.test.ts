import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Transaction } from "@prisma/client";
import TransactionCard from "@/components/pages/wallet/transactions/transaction-card";
import { assessTransactionRisks } from "@/lib/tx-risk/transaction";
import { reviewPendingTransaction } from "@/lib/tx-risk/pending-review";
import {
  address,
  ctx,
  funding,
  native,
  output,
  transaction,
  HUGE_QUANTITY,
} from "./fixtures/tx-risk";

const mockSign = jest.fn(async () => "signed");
const mockSubmit = jest.fn(async () => ({ txHash: "hash", txHex: "signed" }));
const mockUpdate = jest.fn();
const mockAudit = jest.fn(async () => ({ error: null as string | null }));
const mockDecision = jest.fn(async () => ({
  accepted: true,
  acknowledged: true,
}));
const mockReadiness = jest.fn(async () => ({ ready: true }));
const mockWitness = jest.fn(() => true);
let mockCurrent = true;
let mockSignClick: (() => Promise<void>) | undefined;

jest.mock("next/router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/hooks/useMultisigWallet", () => ({
  __esModule: true,
  default: () => ({ multisigWallet: undefined, isLoading: false }),
}));
jest.mock("@/hooks/useMeshWallet", () => ({
  __esModule: true,
  default: () => ({ wallet: {}, connected: true }),
}));
jest.mock("@/hooks/useActiveWallet", () => ({
  __esModule: true,
  default: () => ({
    activeWallet: { signTx: mockSign },
    isWalletReady: true,
    isAnyWalletConnected: true,
  }),
}));
jest.mock("@/hooks/useAppWallet", () => ({
  __esModule: true,
  default: () => ({
    appWallet: {
      id: "wallet",
      name: "Wallet",
      address: address("own"),
      scriptCbor: native.to_hex(),
      type: "any",
      signersAddresses: [address("key")],
      signersDescriptions: [],
      numRequiredSigners: 1,
    },
  }),
}));
jest.mock("@/lib/zustand/user", () => ({
  useUserStore: (select: any) => select({ userAddress: address("key") }),
}));
jest.mock("@/lib/zustand/site", () => ({
  useSiteStore: (select: any) => select({ network: 0 }),
}));
jest.mock("@/lib/zustand/wallets", () => ({
  useWalletsStore: (select: any) => select({ walletAssetMetadata: {} }),
}));
jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));
jest.mock("@/hooks/useProposalTitles", () => ({
  __esModule: true,
  default: () => ({ resolveProposalTitle: () => "" }),
}));
jest.mock("@/utils/get-provider", () => ({ getProvider: () => ({}) }));
jest.mock("@/lib/discord/sendDiscordMessage", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("@/components/common/token-flow/token-flow-section", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/pages/wallet/transactions/collateral-review", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/utils/api", () => ({
  api: {
    useUtils: () => ({
      transaction: { preSignProxyAudit: { fetch: mockAudit } },
    }),
    transaction: {
      updateTransaction: { useMutation: () => ({ mutate: mockUpdate }) },
      deleteTransaction: { useMutation: () => ({ mutate: jest.fn() }) },
    },
    user: { getDiscordIds: { useQuery: () => ({}) } },
    contact: { getAll: { useQuery: () => ({}) } },
  },
}));
jest.mock("@/utils/txSignUtils", () => ({
  resolveExpectedPaymentScriptCbor: () => native.to_hex(),
  mergeSignerWitnesses: () => ({ txHex: "signed", invalidVkeyPubKeysHex: [] }),
  filterWitnessesToScripts: (hex: string) => hex,
  shouldSubmitMultisigTx: () => true,
  submitTxWithScriptRecovery: (...args: unknown[]) =>
    (mockSubmit as Function)(...args),
}));
jest.mock("@/utils/transactionReadiness", () => ({
  hasVerifiedPaymentWitness: () => mockWitness(),
  requiredSignerKeyHashes: () => ["collateral-owner"],
  transactionReadiness: () => mockReadiness(),
}));
// Exercise the card's actual signing path and the real guard/codec. Browser tests
// separately exercise the hook's React lifecycle and dialog decisions.
jest.mock("@/hooks/usePendingTransactionReview", () => ({
  __esModule: true,
  default: (options: any) => {
    const assessment = assessTransactionRisks(options.txHex, ctx, {
      utxos: [funding],
    });
    return {
      assessment,
      loading: false,
      retry: jest.fn(),
      capture: () => ({
        isCurrent: () => mockCurrent,
        review: () =>
          reviewPendingTransaction(options.txHex, {
            network: 0,
            isCurrent: () => mockCurrent,
            refresh: async () => assessment,
            confirm: mockDecision,
          }),
      }),
    };
  },
}));
jest.mock("@/components/common/button", () => ({
  __esModule: true,
  default: (props: any) => {
    if (props["data-testid"]?.startsWith("sign-button"))
      mockSignClick = props.onClick;
    return createElement("button", null, props.children);
  },
}));

function render(
  txJson = "{}",
  signedAddresses: string[] = [],
  txCbor?: string,
) {
  const tx = {
    id: "pending",
    txCbor:
      txCbor ??
      transaction({
        outputs: [output(address("known"), "5000000", true)],
      }),
    txJson,
    state: 0,
    createdAt: new Date("2026-10-22"),
    signedAddresses,
    rejectedAddresses: [],
    description: "Imported",
    txHash: "",
  } as unknown as Transaction;
  return renderToStaticMarkup(
    createElement(TransactionCard, { walletId: "wallet", transaction: tx }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrent = true;
  mockSign.mockResolvedValue("signed");
  mockDecision.mockResolvedValue({ accepted: true, acknowledged: true });
  mockAudit.mockResolvedValue({ error: null });
  mockWitness.mockReturnValue(true);
  mockReadiness.mockResolvedValue({ ready: true });
});

test.each([
  "not json",
  "{}",
  JSON.stringify({
    outputs: [
      {
        address: address("key"),
        amount: [{ unit: "lovelace", quantity: "1" }],
      },
    ],
  }),
])(
  "missing/misleading metadata does not hide CBOR output risks: %s",
  (json) => {
    const html = render(json);
    expect(html).toContain("Anyone can spend");
    expect(html).toContain(HUGE_QUANTITY);
    expect(html).toContain('data-testid="pending-risk-review"');
  },
);

test.each([false, true])(
  "signing and collateral-owner re-signing are gated (already signed=%s)",
  async (alreadySigned) => {
    render("{}", alreadySigned ? [address("key")] : []);
    mockDecision.mockResolvedValue({ accepted: true, acknowledged: false });
    await mockSignClick!();
    expect(mockSign).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
    mockDecision.mockResolvedValue({ accepted: true, acknowledged: true });
    await mockSignClick!();
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  },
);

test.each(["proxy", "review", "wallet", "readiness"])(
  "context changes during %s cannot submit",
  async (stage) => {
    render();
    if (stage === "proxy")
      mockAudit.mockImplementationOnce(async () => {
        mockCurrent = false;
        return { error: null };
      });
    if (stage === "review")
      mockDecision.mockImplementationOnce(async () => {
        mockCurrent = false;
        return { accepted: true, acknowledged: true };
      });
    if (stage === "wallet")
      mockSign.mockImplementationOnce(async () => {
        mockCurrent = false;
        return "signed";
      });
    if (stage === "readiness")
      mockReadiness.mockImplementationOnce(async () => {
        mockCurrent = false;
        return { ready: true };
      });
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      await mockSignClick!();
    } finally {
      error.mockRestore();
    }
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    if (stage === "proxy" || stage === "review")
      expect(mockSign).not.toHaveBeenCalled();
  },
);

test("unreadable CBOR has a retry state and cannot sign despite plausible JSON", async () => {
  const html = render(JSON.stringify({ outputs: [] }), [], "bad-cbor");
  expect(html).toContain("Unable to verify this transaction");
  expect(html).toContain("Retry review");
  await mockSignClick!();
  expect(mockSign).not.toHaveBeenCalled();
  expect(mockSubmit).not.toHaveBeenCalled();
});

test("acknowledgment cannot replace an authorized payment-key signature", async () => {
  render();
  mockWitness.mockReturnValueOnce(false);
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    await mockSignClick!();
  } finally {
    error.mockRestore();
  }
  expect(mockSubmit).not.toHaveBeenCalled();
  expect(mockUpdate).not.toHaveBeenCalled();
});

test("proxy refusal still prevents the wallet prompt", async () => {
  render();
  mockAudit.mockResolvedValueOnce({
    error: "Proxy token would leave the wallet",
  });
  await mockSignClick!();
  expect(mockSign).not.toHaveBeenCalled();
});

test("acknowledgment cannot override missing collateral witnesses", async () => {
  render();
  mockReadiness.mockResolvedValueOnce({ ready: false });
  await mockSignClick!();
  expect(mockSubmit).not.toHaveBeenCalled();
  expect(mockUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ state: 0 }),
  );
});
