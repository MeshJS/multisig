import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/governance/provider", () => ({
  __esModule: true,
  getGovernanceProvider: () => null,
  providerGet: jest.fn(async () => {
    throw new Error("network access not expected in tests");
  }),
}));

jest.mock("@/utils/multisigSDK", () => ({
  __esModule: true,
  addressToNetwork: (address: string) => (address.includes("test") ? 0 : 1),
}));

jest.mock("@/lib/notifications/worker", () => ({
  __esModule: true,
  drainNotificationOutbox: jest.fn(async () => []),
}));

import {
  ballotDeadlineIdempotencyKey,
  computeEpochEndMs,
  enqueueBallotDeadlineReminders,
  selectReminderWindow,
  type LatestEpoch,
  type ProposalDeadlineDetails,
} from "@/lib/notifications/ballotDeadlines";
import {
  getNotificationPreferenceField,
  NOTIFICATION_EVENT_BALLOT_DEADLINE,
  NOTIFICATION_STATUS_PENDING,
} from "@/lib/notifications/events";
import { renderBallotDeadlineEmail } from "@/lib/notifications/templates/ballotDeadline";
import { extractVoteProposalIds } from "@/lib/notifications/voteProposals";

const HOUR = 60 * 60 * 1000;
const PROPOSAL_A = "aa".repeat(32) + "#0";
const PROPOSAL_B = "bb".repeat(32) + "#1";

describe("computeEpochEndMs", () => {
  it("adds whole epochs to the latest epoch's end time", () => {
    expect(
      computeEpochEndMs({ latestEpoch: 500, latestEndTimeSec: 1_000_000, epoch: 500 }),
    ).toBe(1_000_000_000);
    expect(
      computeEpochEndMs({ latestEpoch: 500, latestEndTimeSec: 1_000_000, epoch: 502 }),
    ).toBe((1_000_000 + 2 * 432_000) * 1000);
  });
});

describe("selectReminderWindow", () => {
  it("picks exactly one window and none once the deadline passed", () => {
    expect(selectReminderWindow(-1)).toBeNull();
    expect(selectReminderWindow(0)).toBeNull();
    expect(selectReminderWindow(1)).toBe("24h");
    expect(selectReminderWindow(24 * HOUR)).toBe("24h");
    expect(selectReminderWindow(24 * HOUR + 1)).toBe("48h");
    expect(selectReminderWindow(48 * HOUR)).toBe("48h");
    expect(selectReminderWindow(48 * HOUR + 1)).toBeNull();
  });
});

describe("ballotDeadlineIdempotencyKey", () => {
  it("scopes reminders per resource, signer, window and expiration epoch", () => {
    expect(
      ballotDeadlineIdempotencyKey({
        resourceId: "b1",
        walletId: "w1",
        recipientAddress: "addr",
        window: "24h",
        expirationEpoch: 510,
      }),
    ).toBe("ballot.deadline:email:ballot:b1:w1:addr:24h:510");
    expect(
      ballotDeadlineIdempotencyKey({
        resourceType: "transaction",
        resourceId: "tx1",
        walletId: "w1",
        recipientAddress: "addr",
        window: "48h",
        expirationEpoch: 510,
      }),
    ).toBe("ballot.deadline:email:transaction:tx1:w1:addr:48h:510");
  });
});

describe("getNotificationPreferenceField for ballot.deadline", () => {
  it("gates both ballot and transaction keyed rows by notifyBallotDeadlines", () => {
    expect(getNotificationPreferenceField(NOTIFICATION_EVENT_BALLOT_DEADLINE, "ballot")).toBe(
      "notifyBallotDeadlines",
    );
    expect(
      getNotificationPreferenceField(NOTIFICATION_EVENT_BALLOT_DEADLINE, "transaction"),
    ).toBe("notifyBallotDeadlines");
    expect(getNotificationPreferenceField(NOTIFICATION_EVENT_BALLOT_DEADLINE, "wallet")).toBeNull();
  });
});

describe("extractVoteProposalIds", () => {
  it("reads client-built votes from txJson.votes", () => {
    const txJson = JSON.stringify({
      votes: [
        {
          type: "SimpleScriptVote",
          vote: {
            voter: { type: "DRep", drepId: "drep1" },
            govActionId: { txHash: "aa".repeat(32), txIndex: 0 },
            votingProcedure: { voteKind: "Yes" },
          },
        },
        {
          type: "BasicVote",
          vote: { govActionId: { txHash: "bb".repeat(32), txIndex: 1 } },
        },
      ],
    });
    expect(extractVoteProposalIds(txJson)).toEqual([PROPOSAL_A, PROPOSAL_B]);
  });

  it("reads bot proxy votes from txJson.proxyBot and dedupes across shapes", () => {
    const txJson = {
      votes: [{ vote: { govActionId: { txHash: "aa".repeat(32), txIndex: 0 } } }],
      proxyBot: {
        kind: "proxyVote",
        votes: [
          { proposalId: PROPOSAL_A, voteKind: "Yes" },
          { proposalId: PROPOSAL_B, voteKind: "No" },
        ],
      },
    };
    expect(extractVoteProposalIds(txJson)).toEqual([PROPOSAL_A, PROPOSAL_B]);
  });

  it("ignores malformed entries, other proxy kinds and unparsable input", () => {
    expect(
      extractVoteProposalIds({
        votes: [{ vote: { govActionId: { txHash: 123, txIndex: "0" } } }, null],
        proxyBot: { kind: "proxyDRepCertificate", votes: [{ proposalId: PROPOSAL_A }] },
      }),
    ).toEqual([]);
    expect(extractVoteProposalIds({ proxyBot: { kind: "proxyVote", votes: [{ proposalId: "nope" }] } })).toEqual([]);
    expect(extractVoteProposalIds("{not json")).toEqual([]);
    expect(extractVoteProposalIds(null)).toEqual([]);
  });
});

type Scenario = {
  ballots?: Array<Record<string, unknown>>;
  transactions?: Array<Record<string, unknown>>;
  wallets?: Array<Record<string, unknown>>;
  settings?: Array<Record<string, unknown>>;
  votedTx?: Record<string, unknown> | null;
  proposals?: Record<string, ProposalDeadlineDetails | null>;
  latest?: LatestEpoch;
};

const NOW = new Date("2026-08-27T12:00:00Z");
const LATEST: LatestEpoch = {
  epoch: 600,
  // Latest epoch ends 30h from NOW → a proposal expiring in epoch 600 lands in the 48h window.
  end_time: Math.floor(NOW.getTime() / 1000) + 30 * 3600,
};

function setting(address: string, overrides: Record<string, unknown> = {}) {
  return {
    walletId: "wallet_1",
    signerAddress: address,
    email: `${address}@example.com`,
    emailNormalized: `${address}@example.com`,
    emailVerifiedAt: new Date(),
    emailOptIn: true,
    notifyTransactionSignatures: true,
    notifySignableSignatures: true,
    notifyThresholdReached: true,
    notifyBallotDeadlines: true,
    ...overrides,
  };
}

function voteTxJson(...proposalIds: string[]) {
  return JSON.stringify({
    votes: proposalIds.map((id) => {
      const [txHash, txIndex] = id.split("#");
      return { vote: { govActionId: { txHash, txIndex: Number(txIndex) } } };
    }),
  });
}

const DEFAULT_BALLOT = {
  id: "ballot_1",
  walletId: "wallet_1",
  description: "August votes",
  items: [PROPOSAL_A, PROPOSAL_B],
  itemDescriptions: ["Treasury withdrawal", "Info action"],
  createdAt: new Date("2026-08-20T00:00:00Z"),
};

function makeScenario(overrides: Scenario = {}) {
  const ballots = overrides.ballots ?? [DEFAULT_BALLOT];
  const transactions = overrides.transactions ?? [];
  const wallets = overrides.wallets ?? [
    {
      id: "wallet_1",
      name: "Treasury",
      signersAddresses: ["addr_test_one", "addr_test_two"],
      numRequiredSigners: 2,
      type: "atLeast",
      isArchived: false,
    },
  ];
  const settings = overrides.settings ?? [setting("addr_test_one")];
  const proposals = overrides.proposals ?? {
    [PROPOSAL_A]: { expiration: 600 },
    [PROPOSAL_B]: { expiration: 605 },
  };
  const latest = overrides.latest ?? LATEST;

  const upsert = jest.fn(
    async (args: { create: Record<string, unknown> }) => args.create,
  );
  const fetchLatestEpoch = jest.fn(async (_network: string) => latest);
  const fetchProposal = jest.fn(
    async (_network: string, txHash: string, certIndex: number) =>
      proposals[`${txHash}#${certIndex}`] ?? null,
  );
  const db = {
    ballot: { findMany: jest.fn(async () => ballots) },
    wallet: { findMany: jest.fn(async () => wallets) },
    transaction: {
      findMany: jest.fn(async (_args: unknown) => transactions),
      findFirst: jest.fn(async (_args: unknown) => overrides.votedTx ?? null),
    },
    walletSignerNotificationSetting: {
      findMany: jest.fn(async () => settings),
    },
    notificationDelivery: { upsert },
  };
  return { db, upsert, fetchLatestEpoch, fetchProposal };
}

function createdRows(upsert: ReturnType<typeof makeScenario>["upsert"]) {
  return upsert.mock.calls.map((call) => call[0].create);
}

describe("enqueueBallotDeadlineReminders — ballots", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("enqueues a 48h reminder for the earliest expiring active proposal", async () => {
    const { db, upsert, fetchLatestEpoch, fetchProposal } = makeScenario();

    const result = await enqueueBallotDeadlineReminders(db as any, {
      now: NOW,
      fetchLatestEpoch,
      fetchProposal,
    });

    expect(result).toMatchObject({
      ballotsScanned: 1,
      ballotsDue: 1,
      transactionsScanned: 0,
      transactionsDue: 0,
      remindersEnqueued: 1,
      skipped: 1,
      errors: [],
    });
    expect(fetchLatestEpoch).toHaveBeenCalledTimes(1);
    expect(fetchLatestEpoch).toHaveBeenCalledWith("0");
    expect(fetchProposal).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledTimes(2);

    const created = createdRows(upsert);
    const eligible = created.find((row) => row.recipientAddress === "addr_test_one")!;
    expect(eligible).toMatchObject({
      eventType: NOTIFICATION_EVENT_BALLOT_DEADLINE,
      resourceType: "ballot",
      resourceId: "ballot_1",
      walletId: "wallet_1",
      status: NOTIFICATION_STATUS_PENDING,
      idempotencyKey:
        "ballot.deadline:email:ballot:ballot_1:wallet_1:addr_test_one:48h:600",
      subject: "Ballot closes in 48 hours: Treasury",
    });
    const payload = eligible.payload as Record<string, unknown>;
    expect(payload.window).toBe("48h");
    expect(payload.kind).toBe("ballot");
    expect(payload.deadlineEpoch).toBe(600);
    // Only the proposal that sets the deadline is listed.
    expect(payload.proposals).toEqual([
      { id: PROPOSAL_A, title: "Treasury withdrawal", expirationEpoch: 600 },
    ]);

    const skipped = created.find((row) => row.recipientAddress === "addr_test_two")!;
    expect(skipped).toMatchObject({ status: "skipped_no_email", recipientEmail: null });
  });

  it("uses the 24h window (and never both) inside the final day", async () => {
    const { db, upsert, fetchLatestEpoch, fetchProposal } = makeScenario({
      latest: { epoch: 600, end_time: Math.floor(NOW.getTime() / 1000) + 5 * 3600 },
    });

    await enqueueBallotDeadlineReminders(db as any, {
      now: NOW,
      fetchLatestEpoch,
      fetchProposal,
    });

    expect(createdRows(upsert).map((row) => row.idempotencyKey)).toEqual([
      "ballot.deadline:email:ballot:ballot_1:wallet_1:addr_test_one:24h:600",
      "ballot.deadline:email:ballot:ballot_1:wallet_1:addr_test_two:24h:600",
    ]);
  });

  it("does nothing when the deadline is more than 48h away", async () => {
    const { db, upsert, fetchLatestEpoch, fetchProposal } = makeScenario({
      proposals: {
        [PROPOSAL_A]: { expiration: 601 },
        [PROPOSAL_B]: { expiration: 605 },
      },
    });

    const result = await enqueueBallotDeadlineReminders(db as any, {
      now: NOW,
      fetchLatestEpoch,
      fetchProposal,
    });

    expect(result.ballotsDue).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("ignores proposals that are no longer active or already past expiry", async () => {
    const { db, upsert, fetchLatestEpoch, fetchProposal } = makeScenario({
      proposals: {
        [PROPOSAL_A]: { expiration: 600, enacted_epoch: 599 },
        [PROPOSAL_B]: { expiration: 599 },
      },
    });

    const result = await enqueueBallotDeadlineReminders(db as any, {
      now: NOW,
      fetchLatestEpoch,
      fetchProposal,
    });

    expect(result.ballotsDue).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("skips ballots whose vote transaction was already submitted", async () => {
    const { db, upsert, fetchLatestEpoch, fetchProposal } = makeScenario({
      votedTx: { id: "tx_voted" },
    });

    const result = await enqueueBallotDeadlineReminders(db as any, {
      now: NOW,
      fetchLatestEpoch,
      fetchProposal,
    });

    expect(db.transaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          walletId: "wallet_1",
          state: 1,
          description: {
            in: ["Ballot Vote: August votes", "Proxy Ballot Vote: August votes"],
          },
        }),
      }),
    );
    expect(result).toMatchObject({ ballotsDue: 1, remindersEnqueued: 0, skipped: 1 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("skips archived wallets and fetches each proposal once across ballots", async () => {
    const { db, upsert, fetchProposal, fetchLatestEpoch } = makeScenario({
      ballots: [
        { ...DEFAULT_BALLOT, id: "ballot_1", items: [PROPOSAL_A], itemDescriptions: ["Shared"] },
        { ...DEFAULT_BALLOT, id: "ballot_2", items: [PROPOSAL_A], itemDescriptions: ["Shared"] },
        {
          ...DEFAULT_BALLOT,
          id: "ballot_3",
          walletId: "wallet_archived",
          items: [PROPOSAL_A],
          itemDescriptions: ["Shared"],
        },
      ],
      wallets: [
        {
          id: "wallet_1",
          name: "Treasury",
          signersAddresses: ["addr_test_one"],
          numRequiredSigners: 1,
          type: "atLeast",
          isArchived: false,
        },
      ],
      proposals: { [PROPOSAL_A]: { expiration: 600 } },
    });

    const result = await enqueueBallotDeadlineReminders(db as any, {
      now: NOW,
      fetchLatestEpoch,
      fetchProposal,
    });

    expect(fetchProposal).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ballotsScanned: 3, ballotsDue: 2, remindersEnqueued: 2 });
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("records provider failures without aborting the scan", async () => {
    const { db, upsert, fetchLatestEpoch } = makeScenario();
    const failingFetch = jest.fn(
      async (
        _network: string,
        _txHash: string,
        _certIndex: number,
      ): Promise<ProposalDeadlineDetails | null> => {
        throw new Error("blockfrost down");
      },
    );

    const result = await enqueueBallotDeadlineReminders(db as any, {
      now: NOW,
      fetchLatestEpoch,
      fetchProposal: failingFetch,
    });

    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("blockfrost down");
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("enqueueBallotDeadlineReminders — pending vote transactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const DIRECT_VOTE_TX = {
    id: "tx_vote",
    walletId: "wallet_1",
    txJson: voteTxJson(PROPOSAL_A),
    description: "Vote: Yes - Treasury withdrawal",
    signedAddresses: ["addr_test_one"],
    createdAt: new Date("2026-08-26T00:00:00Z"),
  };

  it("reminds signers about a direct vote that was never added to a ballot", async () => {
    const { db, upsert, fetchLatestEpoch, fetchProposal } = makeScenario({
      ballots: [],
      transactions: [DIRECT_VOTE_TX],
    });

    const result = await enqueueBallotDeadlineReminders(db as any, {
      now: NOW,
      fetchLatestEpoch,
      fetchProposal,
    });

    expect(db.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ state: 0 }),
      }),
    );
    expect(result).toMatchObject({
      ballotsScanned: 0,
      transactionsScanned: 1,
      transactionsDue: 1,
      remindersEnqueued: 1,
      skipped: 1,
    });
    expect(fetchProposal).toHaveBeenCalledTimes(1);

    const created = createdRows(upsert);
    const eligible = created.find((row) => row.recipientAddress === "addr_test_one")!;
    expect(eligible).toMatchObject({
      eventType: NOTIFICATION_EVENT_BALLOT_DEADLINE,
      resourceType: "transaction",
      resourceId: "tx_vote",
      idempotencyKey:
        "ballot.deadline:email:transaction:tx_vote:wallet_1:addr_test_one:48h:600",
      subject: "Vote closes in 48 hours: Treasury",
    });
    const payload = eligible.payload as Record<string, unknown>;
    expect(payload.kind).toBe("transaction");
    expect(payload.signedCount).toBe(1);
    expect(payload.requiredCount).toBe(2);
    expect(String(payload.text)).toContain("1 of 2 required signatures collected");
    expect(String(payload.text)).toContain("Review and sign: ");
    expect(String(payload.text)).toContain("/wallets/wallet_1/transactions");
  });

  it("ignores pending transactions without votes and far-off deadlines", async () => {
    const { db, upsert, fetchLatestEpoch, fetchProposal } = makeScenario({
      ballots: [],
      transactions: [
        { ...DIRECT_VOTE_TX, id: "tx_plain", txJson: JSON.stringify({ outputs: [] }) },
        { ...DIRECT_VOTE_TX, id: "tx_far", txJson: voteTxJson(PROPOSAL_B) },
      ],
    });

    const result = await enqueueBallotDeadlineReminders(db as any, {
      now: NOW,
      fetchLatestEpoch,
      fetchProposal,
    });

    expect(result).toMatchObject({
      transactionsScanned: 1,
      transactionsDue: 0,
      remindersEnqueued: 0,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("defers a ballot to the pending vote transaction that covers its expiring proposals", async () => {
    const { db, upsert, fetchLatestEpoch, fetchProposal } = makeScenario({
      transactions: [
        {
          ...DIRECT_VOTE_TX,
          id: "tx_ballot_vote",
          txJson: voteTxJson(PROPOSAL_A, PROPOSAL_B),
          description: "Ballot Vote: August votes",
        },
      ],
    });

    const result = await enqueueBallotDeadlineReminders(db as any, {
      now: NOW,
      fetchLatestEpoch,
      fetchProposal,
    });

    // One email per signer about this deadline: the transaction's.
    expect(result).toMatchObject({
      ballotsDue: 1,
      transactionsDue: 1,
      remindersEnqueued: 1,
      skipped: 2, // ballot deferred + co-signer without email
    });
    expect(createdRows(upsert).map((row) => row.idempotencyKey)).toEqual([
      "ballot.deadline:email:transaction:tx_ballot_vote:wallet_1:addr_test_one:48h:600",
      "ballot.deadline:email:transaction:tx_ballot_vote:wallet_1:addr_test_two:48h:600",
    ]);
    expect(db.transaction.findFirst).not.toHaveBeenCalled();
  });

  it("still reminds about a ballot that is only partially covered by a pending vote", async () => {
    const proposalC = "cc".repeat(32) + "#2";
    const { db, upsert, fetchLatestEpoch, fetchProposal } = makeScenario({
      ballots: [
        {
          ...DEFAULT_BALLOT,
          items: [PROPOSAL_A, proposalC],
          itemDescriptions: ["Treasury withdrawal", "Constitution"],
        },
      ],
      transactions: [DIRECT_VOTE_TX],
      proposals: {
        [PROPOSAL_A]: { expiration: 600 },
        [proposalC]: { expiration: 600 },
      },
    });

    const result = await enqueueBallotDeadlineReminders(db as any, {
      now: NOW,
      fetchLatestEpoch,
      fetchProposal,
    });

    expect(result).toMatchObject({ ballotsDue: 1, transactionsDue: 1, remindersEnqueued: 2 });
    const keys = createdRows(upsert)
      .filter((row) => row.recipientAddress === "addr_test_one")
      .map((row) => row.idempotencyKey);
    expect(keys).toEqual([
      "ballot.deadline:email:transaction:tx_vote:wallet_1:addr_test_one:48h:600",
      "ballot.deadline:email:ballot:ballot_1:wallet_1:addr_test_one:48h:600",
    ]);
  });
});

describe("renderBallotDeadlineEmail", () => {
  it("lists proposals, the UTC deadline and escapes values", () => {
    const template = renderBallotDeadlineEmail({
      walletName: "Treasury & Co",
      kind: "ballot",
      label: "<b>August</b>",
      window: "24h",
      deadline: new Date("2026-08-28T12:00:00Z"),
      deadlineEpoch: 600,
      proposals: [
        { id: PROPOSAL_A, title: "Withdraw", expirationEpoch: 600 },
        { id: "cc".repeat(32) + "#2", title: null, expirationEpoch: 600 },
      ],
      actionUrl: "https://example.com/wallets/w/governance",
      preferencesUrl: "https://example.com/wallets/w/info",
    });

    expect(template.subject).toBe("Ballot closes in 24 hours: Treasury & Co");
    expect(template.html).toContain("Treasury &amp; Co");
    expect(template.html).toContain("&lt;b&gt;August&lt;/b&gt;");
    expect(template.html).toContain("2026-08-28 12:00 UTC (end of epoch 600)");
    expect(template.html).toContain("Withdraw");
    expect(template.text).toContain("- Withdraw (expires epoch 600)");
    expect(template.text).toContain(`- ${"cc".repeat(32)}#2 (expires epoch 600)`);
    expect(template.text).toContain("Open governance: https://example.com/wallets/w/governance");
    expect(template.text).toContain("you can ignore this reminder");
  });

  it("renders the pending-transaction variant with signature progress", () => {
    const template = renderBallotDeadlineEmail({
      walletName: "Treasury",
      kind: "transaction",
      label: "Vote: Yes - Withdraw",
      window: "48h",
      deadline: new Date("2026-08-29T12:00:00Z"),
      deadlineEpoch: 600,
      proposals: [{ id: PROPOSAL_A, title: null, expirationEpoch: 600 }],
      signedCount: 1,
      requiredCount: 3,
      actionUrl: "https://example.com/wallets/w/transactions",
      preferencesUrl: "https://example.com/wallets/w/info",
    });

    expect(template.subject).toBe("Vote closes in 48 hours: Treasury");
    expect(template.text).toContain('pending vote transaction "Vote: Yes - Withdraw"');
    expect(template.text).toContain("1 of 3 required signatures collected");
    expect(template.text).toContain("Review and sign: https://example.com/wallets/w/transactions");
    expect(template.text).not.toContain("you can ignore this reminder");
  });
});
