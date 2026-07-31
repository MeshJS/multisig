import type { FlowBadge } from "@/types/token-flow";
import type {
  BlockfrostTxDelegation,
  BlockfrostTxStakeCert,
} from "@/types/blockfrost";
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

function describeDrep(drep: any): string | undefined {
  if (!drep) return undefined;
  if (typeof drep.dRepId === "string") return `to ${getFirstAndLast(drep.dRepId)}`;
  if ("alwaysAbstain" in drep) return "always abstain";
  if ("alwaysNoConfidence" in drep) return "always no confidence";
  return undefined;
}

/** Maps a Mesh `Vote` (from MeshTxBuilderBody JSON) to a badge. */
export function meshVoteToBadge(vote: any): FlowBadge {
  const voteKind: string = vote?.vote?.votingProcedure?.voteKind ?? "Abstain";
  const govActionId = vote?.vote?.govActionId;
  const detail = govActionId?.txHash
    ? `${getFirstAndLast(govActionId.txHash)}#${govActionId.txIndex ?? "?"}`
    : undefined;
  const colors: Record<string, string> = {
    yes: "text-green-500 dark:text-green-400",
    no: "text-red-500 dark:text-red-400",
    abstain: "text-muted-foreground",
  };
  return {
    kind: "vote",
    label: `Vote: ${voteKind}`,
    detail,
    color: colors[voteKind.toLowerCase()] ?? "text-muted-foreground",
  };
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
