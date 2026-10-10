import type { PrismaClient } from "@prisma/client";

import { getProposalStatus, parseProposalId } from "@/lib/governance";
import { getGovernanceProvider, providerGet } from "@/lib/governance/provider";
import { getProviderErrorStatus } from "@/lib/server/providerErrors";
import { addressToNetwork } from "@/utils/multisigSDK";
import { getRequiredSignerCount, getSiteUrl } from "./center";
import {
  NOTIFICATION_EVENT_BALLOT_DEADLINE,
  NOTIFICATION_STATUS_PENDING,
} from "./events";
import { createNotificationDelivery } from "./outbox";
import { resolveWalletSignerRecipients } from "./recipients";
import {
  renderBallotDeadlineEmail,
  type BallotDeadlineKind,
  type BallotDeadlineProposal,
  type BallotDeadlineWindow,
} from "./templates/ballotDeadline";
import { extractVoteProposalIds } from "./voteProposals";

/** Both mainnet and preprod run 5-day epochs. */
export const EPOCH_LENGTH_SECONDS = 432_000;

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_24H_MS = 24 * HOUR_MS;
const WINDOW_48H_MS = 48 * HOUR_MS;

export type LatestEpoch = { epoch: number; end_time: number };

export type ProposalDeadlineDetails = {
  expiration?: number | null;
  expired_epoch?: number | null;
  dropped_epoch?: number | null;
  enacted_epoch?: number | null;
  ratified_epoch?: number | null;
};

export type BallotDeadlineFetchers = {
  fetchLatestEpoch: (network: string) => Promise<LatestEpoch>;
  fetchProposal: (
    network: string,
    txHash: string,
    certIndex: number,
  ) => Promise<ProposalDeadlineDetails | null>;
};

/**
 * Blockfrost's `expiration` is the ledger's `expiresAfter`: the proposal is
 * votable through the whole of that epoch and is stamped expired at the
 * boundary into `expiration + 1`. So the voting deadline is the end of the
 * `expiration` epoch, derived from the latest epoch's end time.
 */
export function computeEpochEndMs(args: {
  latestEpoch: number;
  latestEndTimeSec: number;
  epoch: number;
}): number {
  return (
    (args.latestEndTimeSec +
      (args.epoch - args.latestEpoch) * EPOCH_LENGTH_SECONDS) *
    1000
  );
}

/**
 * Exactly one window per run: once inside the final 24h the 48h reminder is
 * never emitted, so a cron outage longer than a day cannot double-send.
 */
export function selectReminderWindow(
  remainingMs: number,
): BallotDeadlineWindow | null {
  if (remainingMs <= 0) return null;
  if (remainingMs <= WINDOW_24H_MS) return "24h";
  if (remainingMs <= WINDOW_48H_MS) return "48h";
  return null;
}

export function ballotDeadlineIdempotencyKey(args: {
  resourceType?: BallotDeadlineKind;
  resourceId: string;
  walletId: string;
  recipientAddress: string;
  window: BallotDeadlineWindow;
  expirationEpoch: number;
}): string {
  return [
    NOTIFICATION_EVENT_BALLOT_DEADLINE,
    "email",
    args.resourceType ?? "ballot",
    args.resourceId,
    args.walletId,
    args.recipientAddress,
    args.window,
    String(args.expirationEpoch),
  ].join(":");
}

/** Descriptions written by governance/ballot/ballot.tsx when a vote tx is built. */
export function ballotVoteDescriptions(description: string | null): string[] {
  const label = description ?? "";
  return [`Ballot Vote: ${label}`, `Proxy Ballot Vote: ${label}`];
}

function defaultFetchers(): BallotDeadlineFetchers {
  const providers = new Map<string, ReturnType<typeof getGovernanceProvider>>();
  const providerFor = (network: string) => {
    if (!providers.has(network)) {
      providers.set(network, getGovernanceProvider(network));
    }
    return providers.get(network) ?? null;
  };
  return {
    fetchLatestEpoch: (network) =>
      providerGet<LatestEpoch>({
        provider: providerFor(network),
        network,
        path: "/epochs/latest",
      }),
    fetchProposal: async (network, txHash, certIndex) => {
      try {
        return await providerGet<ProposalDeadlineDetails>({
          provider: providerFor(network),
          network,
          path: `/governance/proposals/${txHash}/${certIndex}`,
        });
      } catch (error) {
        if (getProviderErrorStatus(error) === 404) return null;
        throw error;
      }
    },
  };
}

function resolveWalletNetwork(signersAddresses: string[]): string | null {
  for (const address of signersAddresses) {
    if (typeof address !== "string" || !address.trim()) continue;
    try {
      return String(addressToNetwork(address.trim()));
    } catch {
      // try the next signer
    }
  }
  return null;
}

export type BallotDeadlineScanResult = {
  ballotsScanned: number;
  ballotsDue: number;
  transactionsScanned: number;
  transactionsDue: number;
  remindersEnqueued: number;
  skipped: number;
  errors: string[];
};

export type EnqueueBallotDeadlineRemindersOptions = Partial<BallotDeadlineFetchers> & {
  now?: Date;
};

type WalletShape = {
  id: string;
  name: string;
  signersAddresses: string[];
  numRequiredSigners: number | null;
  type: string;
};

type ResolvedDeadline = {
  deadlineEpoch: number;
  deadlineMs: number;
  /** Only the proposals that set the deadline (earliest expiration). */
  expiringSoon: BallotDeadlineProposal[];
};

/**
 * Scans every ballot with proposals and every pending transaction that votes,
 * derives the voting deadline from the earliest active proposal's expiration
 * epoch, and enqueues 48h/24h reminder emails for the wallet's signers.
 * Idempotent per resource × signer × window × expiration epoch, so it can run
 * on any schedule.
 */
export async function enqueueBallotDeadlineReminders(
  db: PrismaClient,
  options: EnqueueBallotDeadlineRemindersOptions = {},
): Promise<BallotDeadlineScanResult> {
  const now = options.now ?? new Date();
  const fetchers = defaultFetchers();
  const fetchLatestEpoch = options.fetchLatestEpoch ?? fetchers.fetchLatestEpoch;
  const fetchProposal = options.fetchProposal ?? fetchers.fetchProposal;

  const result: BallotDeadlineScanResult = {
    ballotsScanned: 0,
    ballotsDue: 0,
    transactionsScanned: 0,
    transactionsDue: 0,
    remindersEnqueued: 0,
    skipped: 0,
    errors: [],
  };

  const ballots = await db.ballot.findMany({
    where: { items: { isEmpty: false } },
  });
  result.ballotsScanned = ballots.length;

  // Pending transactions that vote. The `contains` filters keep the txJson
  // payloads we load down to candidates; extractVoteProposalIds decides.
  const pendingVoteTxs = (
    await db.transaction.findMany({
      where: {
        state: 0,
        OR: [
          { txJson: { contains: '"govActionId"' } },
          { txJson: { contains: '"proxyVote"' } },
        ],
      },
      select: {
        id: true,
        walletId: true,
        txJson: true,
        description: true,
        signedAddresses: true,
        createdAt: true,
      },
    })
  )
    .map((tx) => ({ ...tx, proposalIds: extractVoteProposalIds(tx.txJson) }))
    .filter((tx) => tx.proposalIds.length > 0);
  result.transactionsScanned = pendingVoteTxs.length;

  if (ballots.length === 0 && pendingVoteTxs.length === 0) return result;

  const walletIds = new Set<string>();
  for (const ballot of ballots) walletIds.add(ballot.walletId);
  for (const tx of pendingVoteTxs) walletIds.add(tx.walletId);
  const wallets = await db.wallet.findMany({
    where: { id: { in: Array.from(walletIds) }, isArchived: false },
  });
  const walletsById = new Map<string, WalletShape>(
    wallets.map((wallet) => [wallet.id, wallet]),
  );

  const latestEpochByNetwork = new Map<string, LatestEpoch | null>();
  const proposalCache = new Map<string, ProposalDeadlineDetails | null>();

  const latestEpochFor = async (network: string) => {
    if (!latestEpochByNetwork.has(network)) {
      try {
        latestEpochByNetwork.set(network, await fetchLatestEpoch(network));
      } catch (error) {
        result.errors.push(
          `epochs/latest (${network}): ${error instanceof Error ? error.message : String(error)}`,
        );
        latestEpochByNetwork.set(network, null);
      }
    }
    return latestEpochByNetwork.get(network) ?? null;
  };

  const proposalFor = async (network: string, proposalId: string) => {
    const key = `${network}:${proposalId}`;
    if (proposalCache.has(key)) return proposalCache.get(key) ?? null;
    let details: ProposalDeadlineDetails | null = null;
    try {
      const { txHash, certIndex } = parseProposalId(proposalId);
      details = await fetchProposal(network, txHash, certIndex);
    } catch (error) {
      result.errors.push(
        `proposal ${proposalId} (${network}): ${error instanceof Error ? error.message : String(error)}`,
      );
      details = null;
    }
    proposalCache.set(key, details);
    return details;
  };

  const resolveDeadline = async (
    network: string,
    latest: LatestEpoch,
    proposalIds: string[],
    titleFor: (proposalId: string, index: number) => string | null,
  ): Promise<ResolvedDeadline | null> => {
    const active: BallotDeadlineProposal[] = [];
    for (let index = 0; index < proposalIds.length; index++) {
      const proposalId = proposalIds[index]!;
      const details = await proposalFor(network, proposalId);
      if (!details) continue;
      const status = getProposalStatus({
        id: proposalId,
        tx_hash: "",
        cert_index: 0,
        governance_type: "",
        deposit: "",
        return_address: "",
        governance_description: { tag: "" },
        ratified_epoch: details.ratified_epoch ?? null,
        enacted_epoch: details.enacted_epoch ?? null,
        dropped_epoch: details.dropped_epoch ?? null,
        expired_epoch: details.expired_epoch ?? null,
        expiration: details.expiration ?? null,
      });
      if (status !== "active") continue;
      if (
        typeof details.expiration !== "number" ||
        details.expiration < latest.epoch
      ) {
        continue;
      }
      active.push({
        id: proposalId,
        title: titleFor(proposalId, index),
        expirationEpoch: details.expiration,
      });
    }
    if (active.length === 0) return null;

    const deadlineEpoch = Math.min(...active.map((p) => p.expirationEpoch));
    return {
      deadlineEpoch,
      deadlineMs: computeEpochEndMs({
        latestEpoch: latest.epoch,
        latestEndTimeSec: latest.end_time,
        epoch: deadlineEpoch,
      }),
      expiringSoon: active.filter((p) => p.expirationEpoch === deadlineEpoch),
    };
  };

  const siteUrl = getSiteUrl();

  const enqueueRemindersFor = async (args: {
    wallet: WalletShape;
    kind: BallotDeadlineKind;
    resourceId: string;
    label: string | null;
    window: BallotDeadlineWindow;
    deadline: ResolvedDeadline;
    signedCount?: number;
    requiredCount?: number;
  }) => {
    const { wallet, kind, deadline } = args;
    const actionUrl =
      kind === "transaction"
        ? `${siteUrl}/wallets/${wallet.id}/transactions`
        : `${siteUrl}/wallets/${wallet.id}/governance`;
    const preferencesUrl = `${siteUrl}/wallets/${wallet.id}/info`;
    const template = renderBallotDeadlineEmail({
      walletName: wallet.name,
      kind,
      label: args.label,
      window: args.window,
      deadline: new Date(deadline.deadlineMs),
      deadlineEpoch: deadline.deadlineEpoch,
      proposals: deadline.expiringSoon,
      signedCount: args.signedCount,
      requiredCount: args.requiredCount,
      actionUrl,
      preferencesUrl,
    });

    const recipients = await resolveWalletSignerRecipients(db, {
      walletId: wallet.id,
      signerAddresses: wallet.signersAddresses,
      preferenceField: "notifyBallotDeadlines",
    });

    const payloadBase = {
      walletId: wallet.id,
      walletName: wallet.name,
      resourceType: kind,
      resourceId: args.resourceId,
      kind,
      label: args.label,
      window: args.window,
      deadline: new Date(deadline.deadlineMs).toISOString(),
      deadlineEpoch: deadline.deadlineEpoch,
      proposals: deadline.expiringSoon,
      signedCount: args.signedCount ?? null,
      requiredCount: args.requiredCount ?? null,
      actionUrl,
      preferencesUrl,
    };
    const keyFor = (recipientAddress: string) =>
      ballotDeadlineIdempotencyKey({
        resourceType: kind,
        resourceId: args.resourceId,
        walletId: wallet.id,
        recipientAddress,
        window: args.window,
        expirationEpoch: deadline.deadlineEpoch,
      });

    for (const recipient of recipients.eligible) {
      await createNotificationDelivery(db, {
        eventType: NOTIFICATION_EVENT_BALLOT_DEADLINE,
        recipientAddress: recipient.address,
        recipientEmail: recipient.email,
        resourceType: kind,
        resourceId: args.resourceId,
        walletId: wallet.id,
        idempotencyKey: keyFor(recipient.address),
        subject: template.subject,
        payload: {
          ...payloadBase,
          recipientAddress: recipient.address,
          html: template.html,
          text: template.text,
        },
        status: NOTIFICATION_STATUS_PENDING,
      });
      result.remindersEnqueued += 1;
    }

    for (const skipped of recipients.skipped) {
      await createNotificationDelivery(db, {
        eventType: NOTIFICATION_EVENT_BALLOT_DEADLINE,
        recipientAddress: skipped.address,
        recipientEmail: null,
        resourceType: kind,
        resourceId: args.resourceId,
        walletId: wallet.id,
        idempotencyKey: keyFor(skipped.address),
        subject: "Ballot deadline reminder skipped",
        payload: {
          ...payloadBase,
          recipientAddress: skipped.address,
          skipReason: skipped.reason,
        },
        status: skipped.reason,
      });
      result.skipped += 1;
    }
  };

  // Proposals already covered by a pending vote transaction, per wallet. A
  // ballot whose expiring proposals are all covered defers to the transaction
  // reminder so signers get one email about the same vote, not two.
  const coveredProposalsByWallet = new Map<string, Set<string>>();

  for (const tx of pendingVoteTxs) {
    const wallet = walletsById.get(tx.walletId);
    if (!wallet) continue;
    const network = resolveWalletNetwork(wallet.signersAddresses);
    if (!network) continue;
    const latest = await latestEpochFor(network);
    if (!latest) continue;

    const deadline = await resolveDeadline(network, latest, tx.proposalIds, () => null);
    if (!deadline) continue;

    let covered = coveredProposalsByWallet.get(wallet.id);
    if (!covered) {
      covered = new Set();
      coveredProposalsByWallet.set(wallet.id, covered);
    }
    for (const proposalId of tx.proposalIds) covered.add(proposalId);

    const window = selectReminderWindow(deadline.deadlineMs - now.getTime());
    if (!window) continue;
    result.transactionsDue += 1;

    await enqueueRemindersFor({
      wallet,
      kind: "transaction",
      resourceId: tx.id,
      label: tx.description,
      window,
      deadline,
      signedCount: tx.signedAddresses.length,
      requiredCount: getRequiredSignerCount(wallet),
    });
  }

  for (const ballot of ballots) {
    const wallet = walletsById.get(ballot.walletId);
    if (!wallet) continue;
    const network = resolveWalletNetwork(wallet.signersAddresses);
    if (!network) continue;
    const latest = await latestEpochFor(network);
    if (!latest) continue;

    const deadline = await resolveDeadline(
      network,
      latest,
      ballot.items,
      (_proposalId, index) => ballot.itemDescriptions[index] ?? null,
    );
    if (!deadline) continue;

    const window = selectReminderWindow(deadline.deadlineMs - now.getTime());
    if (!window) continue;
    result.ballotsDue += 1;

    const covered = coveredProposalsByWallet.get(wallet.id);
    if (
      covered &&
      deadline.expiringSoon.every((proposal) => covered.has(proposal.id))
    ) {
      result.skipped += 1;
      continue;
    }

    // Best-effort: a submitted vote transaction for this ballot created after
    // the ballot means the reminder is moot. Anchored on createdAt, not
    // updatedAt, which bumps on any rationale/anchor edit.
    const voted = await db.transaction.findFirst({
      where: {
        walletId: wallet.id,
        state: 1,
        description: { in: ballotVoteDescriptions(ballot.description) },
        createdAt: { gte: ballot.createdAt },
      },
      select: { id: true },
    });
    if (voted) {
      result.skipped += 1;
      continue;
    }

    await enqueueRemindersFor({
      wallet,
      kind: "ballot",
      resourceId: ballot.id,
      label: ballot.description,
      window,
      deadline,
    });
  }

  return result;
}
