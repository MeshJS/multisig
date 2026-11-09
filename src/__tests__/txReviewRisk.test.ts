import type { PrismaClient } from "@prisma/client";
import { resolveTxHash } from "@meshsdk/core-cst";
import { runTransactionPreview } from "@/lib/tx-review/preview";
import { runTransactionPropose } from "@/lib/tx-review/propose";
import { runPendingTransactionReview } from "@/lib/tx-review/review";
import { verifyDraftToken } from "@/lib/tx-review/draft-token";
import { assessTransactionRisks } from "@/lib/tx-risk/transaction";
import { riskReviewBinding } from "@/lib/tx-review/risk";
import {
  warningPages,
  reviewCardTree,
  collectCardText,
} from "@/lib/tx-review/card";
import { REVIEW_CARD_HTML } from "@/lib/mcp/apps/review-card";
import type { TxReviewSummary } from "@/lib/tx-review/summary";
import type { ToolContext } from "@/lib/mcp/tools";
import {
  address,
  ctx,
  funding,
  collateral,
  output,
  transaction,
  native,
  TOKEN,
  HUGE_QUANTITY,
} from "./fixtures/tx-risk";

let mockHex: string;
let mockUtxos = [funding, collateral];
const mockProvider = {
  fetchUTxOs: jest.fn(async () => mockUtxos),
  fetchAddressUTxOs: jest.fn(async () => mockUtxos),
};
const mockWalletRow = {
  id: "wallet",
  name: "Treasury",
  scriptCbor: native.to_hex(),
  type: "all",
  numRequiredSigners: 1,
  signersAddresses: [address("key")],
  signersDescriptions: ["Signer"],
};
const mockWallet = {
  walletRow: mockWalletRow,
  network: 0,
  walletAddress: address("own"),
  scriptCbor: native.to_hex(),
  threshold: { required: 1, total: 1, type: "all" },
};
jest.mock("@/utils/get-provider", () => ({ getProvider: () => mockProvider }));
jest.mock("@/utils/get-tx-builder", () => ({ getTxBuilder: async () => ({}) }));
jest.mock("@/lib/tx-draft/build-draft-tx", () => ({
  buildDraftTx: async () => ({
    unsignedTx: mockHex,
    txHash: resolveTxHash(mockHex),
    fee: "200000",
    sizeBytes: mockHex.length / 2,
    // Deliberately misleading builder JSON: the completed CBOR must win.
    body: {
      outputs: [
        {
          address: address("key"),
          amount: [{ unit: "lovelace", quantity: "1" }],
        },
      ],
      inputs: [],
      fee: "1",
    },
  }),
}));
jest.mock("@/lib/tx-review/context", () => ({
  ...jest.requireActual("@/lib/tx-review/context"),
  loadReviewWalletContext: async () => mockWallet,
}));
jest.mock("@/lib/tx-review/metadata", () => ({
  resolveAssetMetadata: async () => ({ metadata: {}, decimalsFor: () => 0 }),
  resolvePoolNames: async () => () => "",
  resolveProposalTitles: async () => () => "",
}));
jest.mock("@/lib/observability/audit", () => ({ audit: async () => {} }));

const caller = {
  subject: address("key"),
  clientName: null,
  botId: null,
  addresses: [address("key")],
  scopes: ["transactions:write"],
  expiresAt: 9999999999,
};
const toolContext = { caller } as ToolContext;
const db = {
  transaction: { findMany: jest.fn(async () => [] as any[]) },
  wallet: { findUnique: async () => mockWalletRow },
  contact: {
    findMany: async () => [
      { address: address("known"), name: "Trusted contact" },
    ],
  },
} as unknown as PrismaClient;
const createPending = jest.fn(async () => ({ id: "pending" })) as any;
const deps = {
  db,
  fetchFreeUtxos: async () => ({ status: 200, body: mockUtxos }),
  omitCard: true,
  createPending,
  riskProvider: mockProvider,
};
const input = {
  walletId: "wallet",
  outputs: [{ address: address("known"), ada: "5" }],
};
const summaryOf = (result: any) => result.body.summary as TxReviewSummary;
const preview = () => runTransactionPreview(input, toolContext, deps);
const pending = (txJson: string) =>
  runPendingTransactionReview(
    { walletId: "wallet", transactionId: "pending" },
    toolContext,
    {
      ...deps,
      fetchPendingTransactions: async () => ({
        status: 200,
        body: [
          {
            id: "pending",
            txJson,
            txCbor: mockHex,
            txHash: "misleading-hash",
            signedAddresses: [],
            rejectedAddresses: [],
          },
        ],
      }),
    },
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockHex = transaction({
    outputs: [
      output(address("known"), "5000000", true),
      output(address("known"), "6000000"),
    ],
  });
  mockUtxos = [funding, collateral];
  (db.transaction.findMany as jest.Mock).mockResolvedValue([]);
});

test("preview, propose and pending reuse the real-CBOR assessment and exact output values", async () => {
  const expected = assessTransactionRisks(mockHex, ctx, { utxos: mockUtxos });
  const first = await preview();
  expect(first.status).toBe(200);
  expect(summaryOf(first).riskAssessment).toEqual(expected);
  expect(summaryOf(first).recipients.map((r) => r.address)).toEqual([
    address("known"),
    address("known"),
  ]);
  expect(summaryOf(first).fee?.quantity).toBe("200000");
  expect(first.text).toContain(HUGE_QUANTITY);
  expect(first.text).toContain(TOKEN);
  expect(first.text).toContain("Output 2");
  const token = (first.body as any).draftToken;
  const claims = verifyDraftToken(token, {
    subject: caller.subject,
    clientId: null,
  });
  expect(claims.ok && claims.claims.riskBinding).toBe(
    riskReviewBinding(expected, ctx, 1),
  );
  const proposed = await runTransactionPropose(
    { draftToken: token },
    toolContext,
    deps,
  );
  expect(proposed.status).toBe(201);
  expect(summaryOf(proposed).riskAssessment).toEqual(expected);
  expect(createPending.mock.calls[0][1].initialSignedAddresses).toEqual([]);
  for (const json of [
    "invalid",
    "{}",
    JSON.stringify({
      outputs: [],
      changeAddress: address("known"),
      inputs: [],
      fee: "1",
    }),
  ]) {
    const reviewed = await pending(json);
    expect(reviewed.status).toBe(200);
    expect(summaryOf(reviewed).riskAssessment).toEqual(expected);
    expect(summaryOf(reviewed).txHash).toBe(expected.txHash);
    expect(summaryOf(reviewed).recipients).toHaveLength(2);
    expect(summaryOf(reviewed).warnings).toEqual(summaryOf(first).warnings);
  }
});

test("image delivery attaches all warning pages and keeps complete structured warnings", async () => {
  const renderPng = jest.fn(async () => Buffer.from("png"));
  const result = await runTransactionPreview(input, toolContext, {
    ...deps,
    omitCard: false,
    renderPng,
  });
  const summary = summaryOf(result);
  const pages = warningPages(summary.warnings);
  expect(result.images).toHaveLength(1 + pages.length);
  expect(renderPng).toHaveBeenCalledTimes(1 + pages.length);
  expect(result.text).toContain("Read every attached risk-detail image page");
  expect(summary.warnings.join("\n")).toContain(TOKEN);
});

test.each(["amount", "destination", "token", "wallet"])(
  "changed %s requires a fresh preview before persistence",
  async (change) => {
    const first = await preview();
    if (change === "amount")
      mockHex = transaction({ outputs: [output(address("known"), "7000000")] });
    if (change === "destination")
      mockHex = transaction({ outputs: [output(address("unknown"))] });
    if (change === "token")
      mockHex = transaction({ outputs: [output(address("known"))] });
    const original = mockWallet.walletAddress;
    if (change === "wallet") mockWallet.walletAddress = address("unknown");
    try {
      const result = await runTransactionPropose(
        { draftToken: (first.body as any).draftToken },
        toolContext,
        deps,
      );
      expect(["REVIEW_CHANGED", "REVIEW_INCOMPLETE"]).toContain(
        (result.body as any).code,
      );
      expect(createPending).not.toHaveBeenCalled();
    } finally {
      mockWallet.walletAddress = original;
    }
  },
);

test("incomplete provider facts retain warnings in pending review and cannot mint a preview token", async () => {
  mockUtxos = [];
  const reviewed = await pending("{}");
  expect(summaryOf(reviewed).riskAssessment?.status).toBe("incomplete");
  expect(reviewed.text).toContain("Unable to verify");
  expect(reviewed.text).toContain(HUGE_QUANTITY);
  const first = await preview();
  expect((first.body as any).draftToken).toBeUndefined();
  expect(createPending).not.toHaveBeenCalled();
});

test("ordinary native input reselection and verified wallet change can vary without another preview", async () => {
  mockHex = transaction({
    outputs: [output(), output(address("own"), "14800000")],
  });
  const first = await preview();
  const reselected = {
    ...funding,
    input: { txHash: "dd".repeat(32), outputIndex: 0 },
  };
  mockUtxos = [reselected];
  mockHex = transaction({
    spending: [reselected.input],
    outputs: [output(), output(address("own"), "9800000")],
  });
  const result = await runTransactionPropose(
    { draftToken: (first.body as any).draftToken },
    toolContext,
    deps,
  );
  expect(result.status).toBe(201);
  expect(result.body).toMatchObject({
    txHashChanged: true,
    txHashChangeReasons: ["utxo-set"],
  });
  expect(createPending).toHaveBeenCalledTimes(1);
});

test("unknown recipients and native self-payments retain their actual classifications", async () => {
  for (const kind of ["unknown", "own"] as const) {
    mockHex = transaction({ outputs: [output(address(kind))] });
    const result = await pending("{}");
    expect(summaryOf(result).riskAssessment?.status).toBe("complete");
    expect(summaryOf(result).riskAssessment?.outputs[0]!.control.kind).toBe(
      kind === "own" ? "wallet-native-script" : "unknown-script",
    );
    expect(
      summaryOf(result).riskAssessment?.findings.some(
        (finding) => finding.requiresAcknowledgment,
      ),
    ).toBe(false);
  }
});

test("replay reviews stored CBOR again and does not create another proposal", async () => {
  const first = await preview();
  const token = (first.body as any).draftToken;
  const verified = verifyDraftToken(token, {
    subject: caller.subject,
    clientId: null,
  });
  if (!verified.ok) throw new Error("token");
  (db.transaction.findMany as jest.Mock).mockResolvedValue([
    {
      id: "existing",
      txCbor: mockHex,
      txJson: JSON.stringify({ mcp: { draftId: verified.claims.jti } }),
      signedAddresses: [],
      rejectedAddresses: [],
    },
  ]);
  mockUtxos = [];
  const replay = await runTransactionPropose(
    { draftToken: token },
    toolContext,
    deps,
  );
  expect((replay.body as any).alreadyExisted).toBe(true);
  expect(summaryOf(replay).riskAssessment?.status).toBe("incomplete");
  expect(replay.text).toContain("Anyone can spend");
  expect(createPending).not.toHaveBeenCalled();
});

test("collateral return exposure, recovery inputs and mandatory decode errors are explicit", async () => {
  mockHex = transaction({
    collateral: [collateral.input],
    returned: output(address("known"), "1500000"),
    total: "500000",
  });
  const result = await pending("{}");
  expect(result.text).toContain("0.5 ADA");
  expect(result.text).toContain("Recorded return: 1.5 ADA");
  expect(
    summaryOf(result).riskAssessment?.findings.some(
      (f) => f.outputRole === "collateral-return",
    ),
  ).toBe(true);
  mockHex = "malformed";
  const bad = await pending("{}");
  expect(bad.text).toContain("Unable to verify");
  expect(summaryOf(bad).recipients).toEqual([]);
});

test("risk warning pages retain every character and bounded height; HTML escapes the same warnings", async () => {
  const summary = summaryOf(await preview());
  const pages = warningPages([
    ...summary.warnings,
    ...Array.from({ length: 30 }, () => summary.warnings[0]!),
  ]);
  expect(pages.length).toBeGreaterThan(1);
  for (const page of pages) {
    const tree = reviewCardTree(summary, page);
    expect(tree.height).toBeLessThanOrEqual(2400);
    expect(collectCardText(tree.element).join("\n")).toContain(
      "Transaction risk review",
    );
  }
  expect(
    pages
      .flatMap((page) => page.lines)
      .join("")
      .replaceAll(" ", ""),
  ).toContain(TOKEN);
  expect(REVIEW_CARD_HTML).toContain('esc("Warning: " + warnings[w])');
  expect(REVIEW_CARD_HTML).toContain(
    "white-space: pre-wrap; overflow-wrap: anywhere",
  );
});
