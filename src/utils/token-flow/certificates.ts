import type { FlowBadge } from "@/types/token-flow";
import type {
  BlockfrostTxDelegation,
  BlockfrostTxStakeCert,
} from "@/types/blockfrost";
import type { TxGovernanceItem } from "@/types/governance";
import type { DraftCertificate, DraftVote } from "@/types/tx-draft";
import { getFirstAndLast } from "@/utils/strings";

/**
 * Badge info derived from a certificate, plus the value flow it implies
 * (in lovelace) so adapters can draw deposit / refund edges.
 */
export type CertBadge = FlowBadge & {
  deposit?: string;
  refund?: string;
};

// Colors follow the existing certificate conventions in the transactions UI
// (DRep registration = blue, deregistration = orange, update = purple).
const CERT_COLORS: Record<string, string> = {
  DRepRegistration: "text-blue-500 dark:text-blue-400",
  DRepDeregistration: "text-orange-500 dark:text-orange-400",
  DRepUpdate: "text-purple-500 dark:text-purple-400",
};

/**
 * Maps a Mesh `Certificate` (from a pending tx's MeshTxBuilderBody JSON) to
 * a badge. Input is untyped because txJson is parsed defensively.
 */
export function meshCertificateToBadge(cert: any): CertBadge {
  const certType = cert?.certType?.type;
  const drepId = cert?.certType?.drepId;
  const stakeAddress = cert?.certType?.stakeKeyAddress;
  const coin = cert?.certType?.coin ?? cert?.certType?.deposit;
  const coinString =
    coin !== undefined && coin !== null && `${coin}` !== "" && !isNaN(Number(coin))
      ? `${coin}`
      : undefined;
  const badge = (
    label: string,
    detail?: string,
    extra?: Pick<CertBadge, "deposit" | "refund">,
  ): CertBadge => ({
    kind: "certificate",
    label,
    detail,
    color: certType ? CERT_COLORS[certType] : undefined,
    ...extra,
  });

  switch (certType) {
    case "DRepRegistration":
      return badge("DRep Registration", drepId && getFirstAndLast(drepId), {
        deposit: coinString,
      });
    case "DRepDeregistration":
      return badge("DRep Deregistration", drepId && getFirstAndLast(drepId), {
        refund: coinString,
      });
    case "DRepUpdate":
      return badge("DRep Update", drepId && getFirstAndLast(drepId));
    case "RegisterStake":
      return badge("Stake Registration", stakeAddress && getFirstAndLast(stakeAddress));
    case "DeregisterStake":
      return badge("Stake Deregistration", stakeAddress && getFirstAndLast(stakeAddress));
    case "DelegateStake":
      return badge(
        "Stake Delegation",
        cert?.certType?.poolId && `to ${getFirstAndLast(cert.certType.poolId)}`,
      );
    case "VoteDelegation":
      return badge("Vote Delegation", describeDrep(cert?.certType?.drep));
    case "StakeAndVoteDelegation":
      return badge("Stake + Vote Delegation");
    case "StakeRegistrationAndDelegation":
      return badge("Stake Registration + Delegation", undefined, {
        deposit: coinString,
      });
    case "VoteRegistrationAndDelegation":
      return badge("Vote Registration + Delegation", undefined, {
        deposit: coinString,
      });
    case "StakeVoteRegistrationAndDelegation":
      return badge("Stake + Vote Registration + Delegation", undefined, {
        deposit: coinString,
      });
    case "RegisterPool":
      return badge("Pool Registration");
    case "RetirePool":
      return badge("Pool Retirement");
    case "CommitteeHotAuth":
      return badge("Committee Hot Key Authorization");
    case "CommitteeColdResign":
      return badge("Committee Cold Key Resignation");
    default:
      return badge("Certificate");
  }
}

/** Resolves a bech32 pool id to a display name; injected, may be absent. */
export type PoolNameResolver = (poolId: string) => string | undefined;

/** Maps a builder DraftCertificate to a badge; mirrors `meshCertificateToBadge`. */
export function draftCertificateToBadge(
  cert: DraftCertificate,
  resolvePoolName?: PoolNameResolver,
): FlowBadge {
  switch (cert.kind) {
    case "RegisterStake":
      return {
        kind: "certificate",
        label: "Stake Registration",
        detail: cert.originalStakeAddress
          ? getFirstAndLast(cert.originalStakeAddress)
          : undefined,
        color: "text-blue-500 dark:text-blue-400",
      };
    case "DeregisterStake":
      return {
        kind: "certificate",
        label: "Stake Deregistration",
        detail: cert.originalStakeAddress
          ? getFirstAndLast(cert.originalStakeAddress)
          : undefined,
        color: "text-orange-500 dark:text-orange-400",
      };
    case "DelegateStake": {
      // A resolved pool name goes into `title` — on the tx card only titled
      // badges render visible text (detail is just the hover tooltip).
      const poolName = cert.poolId ? resolvePoolName?.(cert.poolId) : undefined;
      return {
        kind: "certificate",
        label: "Stake Delegation",
        detail: cert.poolId ? `to ${getFirstAndLast(cert.poolId)}` : undefined,
        color: "text-teal-500 dark:text-teal-400",
        ...(poolName ? { title: poolName } : {}),
      };
    }
  }
}

function describeDrep(drep: any): string | undefined {
  if (!drep) return undefined;
  if (typeof drep.dRepId === "string") return `to ${getFirstAndLast(drep.dRepId)}`;
  if ("alwaysAbstain" in drep) return "always abstain";
  if ("alwaysNoConfidence" in drep) return "always no confidence";
  return undefined;
}

const VOTE_COLORS: Record<string, string> = {
  yes: "text-green-500 dark:text-green-400",
  no: "text-red-500 dark:text-red-400",
  abstain: "text-muted-foreground",
};

/** Resolves "txHash#certIndex" to a proposal title; injected, may be absent. */
export type ProposalTitleResolver = (proposalId: string) => string | undefined;

function voteBadge(
  voteKind: string,
  govActionTxHash: string | undefined,
  govActionIndex: number | string | undefined,
  resolveProposalTitle?: ProposalTitleResolver,
): FlowBadge {
  const detail = govActionTxHash
    ? `${getFirstAndLast(govActionTxHash)}#${govActionIndex ?? "?"}`
    : undefined;
  const title =
    govActionTxHash && govActionIndex !== undefined
      ? resolveProposalTitle?.(`${govActionTxHash}#${govActionIndex}`)
      : undefined;
  return {
    kind: "vote",
    label: `Vote: ${voteKind}`,
    detail,
    color: VOTE_COLORS[voteKind.toLowerCase()] ?? "text-muted-foreground",
    ...(title ? { title } : {}),
  };
}

/** Maps a Mesh `Vote` (from MeshTxBuilderBody JSON) to a badge. */
export function meshVoteToBadge(
  vote: any,
  resolveProposalTitle?: ProposalTitleResolver,
): FlowBadge {
  const voteKind: string = vote?.vote?.votingProcedure?.voteKind ?? "Abstain";
  const govActionId = vote?.vote?.govActionId;
  return voteBadge(
    voteKind,
    govActionId?.txHash,
    govActionId?.txIndex,
    resolveProposalTitle,
  );
}

/** Maps a builder DraftVote to a badge; mirrors `meshVoteToBadge`. */
export function draftVoteToBadge(
  vote: DraftVote,
  resolveProposalTitle?: ProposalTitleResolver,
): FlowBadge {
  return voteBadge(
    vote.voteKind,
    vote.govActionTxHash,
    vote.govActionIndex,
    resolveProposalTitle,
  );
}

/**
 * Koios tx_info cert types → badge labels/colors, matching
 * `meshCertificateToBadge` so pending and on-chain cards read identically.
 * Stake/pool types are ABSENT on purpose: those are already badged from
 * Blockfrost per-tx detail (`blockfrostCertBadges`) and must not duplicate.
 */
const KOIOS_CERT_BADGES: Record<string, { label: string; color?: string }> = {
  drep_registration: {
    label: "DRep Registration",
    color: CERT_COLORS.DRepRegistration,
  },
  drep_retire: {
    label: "DRep Deregistration",
    color: CERT_COLORS.DRepDeregistration,
  },
  drep_deregistration: {
    label: "DRep Deregistration",
    color: CERT_COLORS.DRepDeregistration,
  },
  drep_update: { label: "DRep Update", color: CERT_COLORS.DRepUpdate },
  vote_delegation: { label: "Vote Delegation" },
  stake_vote_delegation: { label: "Stake + Vote Delegation" },
  vote_reg_delegation: { label: "Vote Registration + Delegation" },
  stake_vote_reg_delegation: {
    label: "Stake + Vote Registration + Delegation",
  },
  auth_committee_hot: { label: "Committee Hot Key Authorization" },
  resign_committee_cold: { label: "Committee Cold Key Resignation" },
};

const KOIOS_STAKE_POOL_CERT_TYPES = new Set([
  "stake_registration",
  "stake_deregistration",
  "delegation",
  "pool_delegation",
  "pool_update",
  "pool_retire",
]);

/**
 * Badges for one tx's governance activity from /api/governance/txGovernance
 * (Koios tx_info). Certificates order before votes, matching the pending-tx
 * adapter. Proposal titles arrive pre-joined server-side.
 */
export function txGovernanceToBadges(
  item: Pick<TxGovernanceItem, "certs" | "votes">,
): FlowBadge[] {
  const badges: FlowBadge[] = [];
  for (const cert of item.certs) {
    const type = cert.type.toLowerCase();
    // The route filters these out already; skip defensively on drift.
    if (KOIOS_STAKE_POOL_CERT_TYPES.has(type)) continue;
    const known = KOIOS_CERT_BADGES[type];
    badges.push({
      kind: "certificate",
      label: known?.label ?? "Certificate",
      detail: cert.drepId ? getFirstAndLast(cert.drepId) : undefined,
      color: known?.color,
    });
  }
  for (const vote of item.votes) {
    badges.push(
      voteBadge(
        vote.voteKind,
        vote.proposalTxHash,
        vote.proposalIndex,
        () => vote.proposalTitle ?? undefined,
      ),
    );
  }
  return badges;
}

/** Timeline join index: tx hash (lowercased) → governance badges. */
export function buildTxGovernanceBadgeMap(
  items: TxGovernanceItem[],
): Map<string, FlowBadge[]> {
  const map = new Map<string, FlowBadge[]>();
  for (const item of items) {
    const badges = txGovernanceToBadges(item);
    if (badges.length > 0) map.set(item.txHash.toLowerCase(), badges);
  }
  return map;
}

/** Badges for on-chain certificates reported by Blockfrost tx endpoints. */
export function blockfrostCertBadges(data: {
  delegations?: BlockfrostTxDelegation[];
  stakes?: BlockfrostTxStakeCert[];
  poolUpdateCount?: number;
  poolRetireCount?: number;
}): FlowBadge[] {
  const badges: FlowBadge[] = [];
  for (const stake of data.stakes ?? []) {
    badges.push({
      kind: "certificate",
      label: stake.registration ? "Stake Registration" : "Stake Deregistration",
      detail: getFirstAndLast(stake.address),
      color: stake.registration
        ? "text-blue-500 dark:text-blue-400"
        : "text-orange-500 dark:text-orange-400",
    });
  }
  for (const delegation of data.delegations ?? []) {
    badges.push({
      kind: "certificate",
      label: "Stake Delegation",
      detail: `to ${getFirstAndLast(delegation.pool_id)}`,
      color: "text-teal-500 dark:text-teal-400",
    });
  }
  if (data.poolUpdateCount) {
    badges.push({ kind: "certificate", label: "Pool Registration / Update" });
  }
  if (data.poolRetireCount) {
    badges.push({ kind: "certificate", label: "Pool Retirement" });
  }
  return badges;
}
