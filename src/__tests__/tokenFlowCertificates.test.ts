import { describe, expect, it } from "@jest/globals";

import {
  blockfrostCertBadges,
  draftVoteToBadge,
  meshCertificateToBadge,
  meshVoteToBadge,
} from "@/utils/token-flow/certificates";
import { getFirstAndLast } from "@/utils/strings";

const DREP_ID = "drep1abcdefghijklmnopqrstuvwxyz0123456789abcdef";
const STAKE_ADDRESS = "stake_test1uprrw2j075m8yq4wk60l2cwcc02943cueny9qc9q93s7ejgeu5ll8";
const POOL_ID = "pool1abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmn";

function cert(certType: Record<string, unknown>) {
  return { certType };
}

describe("meshCertificateToBadge", () => {
  it("maps DRep registration with deposit and truncated DRep id", () => {
    const badge = meshCertificateToBadge(
      cert({ type: "DRepRegistration", drepId: DREP_ID, coin: "500000000" }),
    );
    expect(badge).toEqual({
      kind: "certificate",
      label: "DRep Registration",
      detail: getFirstAndLast(DREP_ID),
      color: "text-blue-500 dark:text-blue-400",
      deposit: "500000000",
    });
  });

  it("maps DRep deregistration as a refund", () => {
    const badge = meshCertificateToBadge(
      cert({ type: "DRepDeregistration", drepId: DREP_ID, coin: 500000000 }),
    );
    expect(badge.label).toBe("DRep Deregistration");
    expect(badge.refund).toBe("500000000");
    expect(badge.deposit).toBeUndefined();
    expect(badge.color).toBe("text-orange-500 dark:text-orange-400");
  });

  it("maps DRep update with the purple convention color and no value flow", () => {
    const badge = meshCertificateToBadge(
      cert({ type: "DRepUpdate", drepId: DREP_ID }),
    );
    expect(badge.label).toBe("DRep Update");
    expect(badge.color).toBe("text-purple-500 dark:text-purple-400");
    expect(badge.deposit).toBeUndefined();
    expect(badge.refund).toBeUndefined();
  });

  it("reads the deposit from certType.deposit when coin is absent", () => {
    const badge = meshCertificateToBadge(
      cert({ type: "DRepRegistration", deposit: "2000000" }),
    );
    expect(badge.deposit).toBe("2000000");
  });

  it("drops non-numeric and empty coin values", () => {
    expect(
      meshCertificateToBadge(cert({ type: "DRepRegistration", coin: "not-a-number" }))
        .deposit,
    ).toBeUndefined();
    expect(
      meshCertificateToBadge(cert({ type: "DRepRegistration", coin: "" })).deposit,
    ).toBeUndefined();
  });

  it("maps stake registration and deregistration with the stake address detail", () => {
    const reg = meshCertificateToBadge(
      cert({ type: "RegisterStake", stakeKeyAddress: STAKE_ADDRESS }),
    );
    expect(reg.label).toBe("Stake Registration");
    expect(reg.detail).toBe(getFirstAndLast(STAKE_ADDRESS));

    const dereg = meshCertificateToBadge(
      cert({ type: "DeregisterStake", stakeKeyAddress: STAKE_ADDRESS }),
    );
    expect(dereg.label).toBe("Stake Deregistration");
    expect(dereg.detail).toBe(getFirstAndLast(STAKE_ADDRESS));
  });

  it("maps stake delegation with the target pool", () => {
    const badge = meshCertificateToBadge(
      cert({ type: "DelegateStake", poolId: POOL_ID }),
    );
    expect(badge.label).toBe("Stake Delegation");
    expect(badge.detail).toBe(`to ${getFirstAndLast(POOL_ID)}`);
  });

  it("maps vote delegation to a specific DRep", () => {
    const badge = meshCertificateToBadge(
      cert({ type: "VoteDelegation", drep: { dRepId: DREP_ID } }),
    );
    expect(badge.label).toBe("Vote Delegation");
    expect(badge.detail).toBe(`to ${getFirstAndLast(DREP_ID)}`);
  });

  it("describes the special always-abstain and always-no-confidence DReps", () => {
    expect(
      meshCertificateToBadge(cert({ type: "VoteDelegation", drep: { alwaysAbstain: null } }))
        .detail,
    ).toBe("always abstain");
    expect(
      meshCertificateToBadge(
        cert({ type: "VoteDelegation", drep: { alwaysNoConfidence: null } }),
      ).detail,
    ).toBe("always no confidence");
    expect(
      meshCertificateToBadge(cert({ type: "VoteDelegation" })).detail,
    ).toBeUndefined();
    expect(
      meshCertificateToBadge(cert({ type: "VoteDelegation", drep: {} })).detail,
    ).toBeUndefined();
  });

  it("maps the combined delegation and registration certificate variants", () => {
    expect(
      meshCertificateToBadge(cert({ type: "StakeAndVoteDelegation" })).label,
    ).toBe("Stake + Vote Delegation");

    const stakeReg = meshCertificateToBadge(
      cert({ type: "StakeRegistrationAndDelegation", coin: "2000000" }),
    );
    expect(stakeReg.label).toBe("Stake Registration + Delegation");
    expect(stakeReg.deposit).toBe("2000000");

    const voteReg = meshCertificateToBadge(
      cert({ type: "VoteRegistrationAndDelegation", coin: "2000000" }),
    );
    expect(voteReg.label).toBe("Vote Registration + Delegation");
    expect(voteReg.deposit).toBe("2000000");

    const both = meshCertificateToBadge(
      cert({ type: "StakeVoteRegistrationAndDelegation", coin: "2000000" }),
    );
    expect(both.label).toBe("Stake + Vote Registration + Delegation");
    expect(both.deposit).toBe("2000000");
  });

  it("maps pool and committee certificates", () => {
    expect(meshCertificateToBadge(cert({ type: "RegisterPool" })).label).toBe(
      "Pool Registration",
    );
    expect(meshCertificateToBadge(cert({ type: "RetirePool" })).label).toBe(
      "Pool Retirement",
    );
    expect(meshCertificateToBadge(cert({ type: "CommitteeHotAuth" })).label).toBe(
      "Committee Hot Key Authorization",
    );
    expect(meshCertificateToBadge(cert({ type: "CommitteeColdResign" })).label).toBe(
      "Committee Cold Key Resignation",
    );
  });

  it("falls back to a generic badge for unknown or malformed certificates", () => {
    expect(meshCertificateToBadge(cert({ type: "SomethingNew" }))).toEqual({
      kind: "certificate",
      label: "Certificate",
      detail: undefined,
      color: undefined,
    });
    expect(meshCertificateToBadge(undefined).label).toBe("Certificate");
    expect(meshCertificateToBadge({}).label).toBe("Certificate");
  });
});

describe("meshVoteToBadge", () => {
  const GOV_ACTION_TX = "ab".repeat(32);

  function vote(voteKind: string, govActionId?: { txHash: string; txIndex?: number }) {
    return { vote: { votingProcedure: { voteKind }, govActionId } };
  }

  it("colors yes, no, and abstain votes", () => {
    expect(meshVoteToBadge(vote("Yes")).color).toBe("text-green-500 dark:text-green-400");
    expect(meshVoteToBadge(vote("No")).color).toBe("text-red-500 dark:text-red-400");
    expect(meshVoteToBadge(vote("Abstain")).color).toBe("text-muted-foreground");
  });

  it("labels the vote and references the governance action", () => {
    const badge = meshVoteToBadge(vote("Yes", { txHash: GOV_ACTION_TX, txIndex: 3 }));
    expect(badge.kind).toBe("vote");
    expect(badge.label).toBe("Vote: Yes");
    expect(badge.detail).toBe(`${getFirstAndLast(GOV_ACTION_TX)}#3`);
  });

  it("marks a missing action index and omits the detail without an action id", () => {
    expect(meshVoteToBadge(vote("No", { txHash: GOV_ACTION_TX })).detail).toBe(
      `${getFirstAndLast(GOV_ACTION_TX)}#?`,
    );
    expect(meshVoteToBadge(vote("No")).detail).toBeUndefined();
  });

  it("defaults to a neutral abstain badge for malformed votes", () => {
    const badge = meshVoteToBadge(undefined);
    expect(badge.label).toBe("Vote: Abstain");
    expect(badge.color).toBe("text-muted-foreground");
  });

  it("keeps unknown vote kinds readable with the neutral color", () => {
    const badge = meshVoteToBadge(vote("Maybe"));
    expect(badge.label).toBe("Vote: Maybe");
    expect(badge.color).toBe("text-muted-foreground");
  });
});

describe("blockfrostCertBadges", () => {
  it("returns no badges for an empty certificate summary", () => {
    expect(blockfrostCertBadges({})).toEqual([]);
  });

  it("maps stake registrations and deregistrations with their colors", () => {
    const badges = blockfrostCertBadges({
      stakes: [
        { cert_index: 0, address: STAKE_ADDRESS, registration: true },
        { cert_index: 1, address: STAKE_ADDRESS, registration: false },
      ],
    });
    expect(badges).toEqual([
      {
        kind: "certificate",
        label: "Stake Registration",
        detail: getFirstAndLast(STAKE_ADDRESS),
        color: "text-blue-500 dark:text-blue-400",
      },
      {
        kind: "certificate",
        label: "Stake Deregistration",
        detail: getFirstAndLast(STAKE_ADDRESS),
        color: "text-orange-500 dark:text-orange-400",
      },
    ]);
  });

  it("maps delegations to their pool", () => {
    const badges = blockfrostCertBadges({
      delegations: [
        { index: 0, cert_index: 0, address: STAKE_ADDRESS, pool_id: POOL_ID },
      ],
    });
    expect(badges).toEqual([
      {
        kind: "certificate",
        label: "Stake Delegation",
        detail: `to ${getFirstAndLast(POOL_ID)}`,
        color: "text-teal-500 dark:text-teal-400",
      },
    ]);
  });

  it("adds pool lifecycle badges only when counts are non-zero", () => {
    expect(blockfrostCertBadges({ poolUpdateCount: 0, poolRetireCount: 0 })).toEqual([]);
    expect(blockfrostCertBadges({ poolUpdateCount: 2, poolRetireCount: 1 })).toEqual([
      { kind: "certificate", label: "Pool Registration / Update" },
      { kind: "certificate", label: "Pool Retirement" },
    ]);
  });
});

describe("vote badge proposal titles", () => {
  const GOV_HASH = "ab".repeat(32);
  const resolver = (pid: string) =>
    pid === `${GOV_HASH}#3` ? "Treasury Withdrawal Q3" : undefined;

  test("meshVoteToBadge sets title via the resolver", () => {
    const badge = meshVoteToBadge(
      {
        type: "BasicVote",
        vote: {
          voter: { type: "DRep", drepId: "drep1abc" },
          govActionId: { txHash: GOV_HASH, txIndex: 3 },
          votingProcedure: { voteKind: "Yes" },
        },
      },
      resolver,
    );
    expect(badge.title).toBe("Treasury Withdrawal Q3");
    expect(badge.label).toBe("Vote: Yes");
  });

  test("meshVoteToBadge without a resolver has no title (regression)", () => {
    const badge = meshVoteToBadge({
      type: "BasicVote",
      vote: {
        voter: { type: "DRep", drepId: "drep1abc" },
        govActionId: { txHash: GOV_HASH, txIndex: 3 },
        votingProcedure: { voteKind: "No" },
      },
    });
    expect(badge.title).toBeUndefined();
  });

  test("draftVoteToBadge mirrors meshVoteToBadge for the same vote", () => {
    const fromDraft = draftVoteToBadge(
      {
        id: "v-1",
        govActionTxHash: GOV_HASH,
        govActionIndex: 3,
        voteKind: "Abstain",
      },
      resolver,
    );
    const fromMesh = meshVoteToBadge(
      {
        type: "SimpleScriptVote",
        vote: {
          voter: { type: "DRep", drepId: "drep1abc" },
          govActionId: { txHash: GOV_HASH, txIndex: 3 },
          votingProcedure: { voteKind: "Abstain" },
        },
      },
      resolver,
    );
    expect(fromDraft).toEqual(fromMesh);
  });

  test("unresolved title falls back to no title, detail intact", () => {
    const badge = draftVoteToBadge({
      id: "v-1",
      govActionTxHash: GOV_HASH,
      govActionIndex: 9,
      voteKind: "Yes",
    }, resolver);
    expect(badge.title).toBeUndefined();
    expect(badge.detail).toContain("#9");
  });
});
