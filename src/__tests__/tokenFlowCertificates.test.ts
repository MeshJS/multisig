import { describe, expect, it } from "@jest/globals";

import {
  blockfrostCertBadges,
  buildTxGovernanceBadgeMap,
  draftCertificateToBadge,
  draftVoteToBadge,
  meshCertificateToBadge,
  meshVoteToBadge,
  txGovernanceToBadges,
} from "@/utils/token-flow/certificates";
import { getFirstAndLast } from "@/utils/strings";
import type { TxGovernanceItem } from "@/types/governance";

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

describe("draftCertificateToBadge", () => {
  it("maps a draft delegation with the target pool and teal color", () => {
    const badge = draftCertificateToBadge({
      id: "c-1",
      kind: "DelegateStake",
      poolId: POOL_ID,
      originalStakeAddress: STAKE_ADDRESS,
    });
    expect(badge).toEqual({
      kind: "certificate",
      label: "Stake Delegation",
      detail: `to ${getFirstAndLast(POOL_ID)}`,
      color: "text-teal-500 dark:text-teal-400",
    });
  });

  it("maps register/deregister with the provenance stake address detail", () => {
    const reg = draftCertificateToBadge({
      id: "c-1",
      kind: "RegisterStake",
      originalStakeAddress: STAKE_ADDRESS,
    });
    expect(reg.label).toBe("Stake Registration");
    expect(reg.detail).toBe(getFirstAndLast(STAKE_ADDRESS));
    expect(reg.color).toBe("text-blue-500 dark:text-blue-400");

    const dereg = draftCertificateToBadge({
      id: "c-2",
      kind: "DeregisterStake",
    });
    expect(dereg.label).toBe("Stake Deregistration");
    expect(dereg.detail).toBeUndefined();
    expect(dereg.color).toBe("text-orange-500 dark:text-orange-400");
  });

  it("omits the detail when a delegation has no pool yet", () => {
    const badge = draftCertificateToBadge({ id: "c-1", kind: "DelegateStake" });
    expect(badge.detail).toBeUndefined();
  });

  it("sets the resolved pool name as the delegation badge title", () => {
    const named = draftCertificateToBadge(
      { id: "c-1", kind: "DelegateStake", poolId: POOL_ID },
      (poolId) => (poolId === POOL_ID ? "[TICKER] My Pool" : undefined),
    );
    // Title renders as visible text on the tx card; detail stays the
    // truncated pool id (hover tooltip).
    expect(named.title).toBe("[TICKER] My Pool");
    expect(named.detail).toBe(`to ${getFirstAndLast(POOL_ID)}`);

    // Resolver misses leave the badge untitled (compact pill).
    const missed = draftCertificateToBadge(
      { id: "c-1", kind: "DelegateStake", poolId: POOL_ID },
      () => undefined,
    );
    expect(missed.title).toBeUndefined();
    expect(missed.detail).toBe(`to ${getFirstAndLast(POOL_ID)}`);
  });

  it("maps a builder-created cert (no provenance address) cleanly", () => {
    const badge = draftCertificateToBadge({
      id: "c-1",
      kind: "RegisterStake",
      origin: "user",
      pairId: "p-1",
    });
    expect(badge).toEqual({
      kind: "certificate",
      label: "Stake Registration",
      detail: undefined,
      color: "text-blue-500 dark:text-blue-400",
    });
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

const PROPOSAL_TX = "cd".repeat(32);

function govItem(overrides: Partial<TxGovernanceItem> = {}): TxGovernanceItem {
  return {
    txHash: "ef".repeat(32),
    certs: [],
    votes: [],
    ...overrides,
  };
}

function govVote(
  overrides: Partial<TxGovernanceItem["votes"][number]> = {},
): TxGovernanceItem["votes"][number] {
  return {
    voterRole: "DRep",
    voteKind: "Yes",
    proposalTxHash: PROPOSAL_TX,
    proposalIndex: 0,
    proposalTitle: null,
    ...overrides,
  };
}

describe("txGovernanceToBadges", () => {
  it("maps DRep lifecycle certs with meshCertificateToBadge's labels and colors", () => {
    const reg = txGovernanceToBadges(
      govItem({ certs: [{ type: "drep_registration", drepId: DREP_ID }] }),
    );
    expect(reg).toEqual([
      {
        kind: "certificate",
        label: meshCertificateToBadge(cert({ type: "DRepRegistration" })).label,
        detail: getFirstAndLast(DREP_ID),
        color: "text-blue-500 dark:text-blue-400",
      },
    ]);

    const retire = txGovernanceToBadges(
      govItem({ certs: [{ type: "drep_retire", drepId: null }] }),
    );
    expect(retire[0]).toMatchObject({
      label: "DRep Deregistration",
      detail: undefined,
      color: "text-orange-500 dark:text-orange-400",
    });

    const update = txGovernanceToBadges(
      govItem({ certs: [{ type: "drep_update", drepId: DREP_ID }] }),
    );
    expect(update[0]).toMatchObject({
      label: "DRep Update",
      color: "text-purple-500 dark:text-purple-400",
    });
  });

  it("maps vote-delegation and committee certs", () => {
    const labels = (types: string[]) =>
      txGovernanceToBadges(
        govItem({ certs: types.map((type) => ({ type, drepId: null })) }),
      ).map((badge) => badge.label);
    expect(
      labels([
        "vote_delegation",
        "stake_vote_delegation",
        "auth_committee_hot",
        "resign_committee_cold",
      ]),
    ).toEqual([
      "Vote Delegation",
      "Stake + Vote Delegation",
      "Committee Hot Key Authorization",
      "Committee Cold Key Resignation",
    ]);
  });

  it("skips stake/pool certs (already badged from Blockfrost detail)", () => {
    const badges = txGovernanceToBadges(
      govItem({
        certs: [
          { type: "stake_registration", drepId: null },
          { type: "pool_delegation", drepId: null },
          { type: "drep_registration", drepId: null },
        ],
      }),
    );
    expect(badges.map((badge) => badge.label)).toEqual(["DRep Registration"]);
  });

  it("falls back to a generic badge for unknown cert types", () => {
    const badges = txGovernanceToBadges(
      govItem({ certs: [{ type: "something_new", drepId: null }] }),
    );
    expect(badges[0]).toMatchObject({ kind: "certificate", label: "Certificate" });
    expect(badges[0]!.color).toBeUndefined();
  });

  it("maps votes with colors, proposal detail, and optional title", () => {
    const badges = txGovernanceToBadges(
      govItem({
        votes: [
          govVote({ voteKind: "Yes", proposalIndex: 3, proposalTitle: "Treasury Withdrawal Q3" }),
          govVote({ voteKind: "No" }),
          govVote({ voteKind: "Abstain" }),
        ],
      }),
    );
    expect(badges[0]).toMatchObject({
      kind: "vote",
      label: "Vote: Yes",
      detail: `${getFirstAndLast(PROPOSAL_TX)}#3`,
      color: "text-green-500 dark:text-green-400",
      title: "Treasury Withdrawal Q3",
    });
    expect(badges[1]).toMatchObject({
      label: "Vote: No",
      color: "text-red-500 dark:text-red-400",
    });
    expect(badges[1]!.title).toBeUndefined();
    expect(badges[2]).toMatchObject({
      label: "Vote: Abstain",
      color: "text-muted-foreground",
    });
  });

  it("mirrors draftVoteToBadge for the same vote and title", () => {
    const fromGovernance = txGovernanceToBadges(
      govItem({
        votes: [
          govVote({
            voteKind: "Abstain",
            proposalIndex: 3,
            proposalTitle: "Treasury Withdrawal Q3",
          }),
        ],
      }),
    )[0];
    const fromDraft = draftVoteToBadge(
      {
        id: "v-1",
        govActionTxHash: PROPOSAL_TX,
        govActionIndex: 3,
        voteKind: "Abstain",
      },
      (pid) =>
        pid === `${PROPOSAL_TX}#3` ? "Treasury Withdrawal Q3" : undefined,
    );
    expect(fromGovernance).toEqual(fromDraft);
  });

  it("orders certificate badges before vote badges", () => {
    const badges = txGovernanceToBadges(
      govItem({
        certs: [{ type: "drep_registration", drepId: null }],
        votes: [govVote()],
      }),
    );
    expect(badges.map((badge) => badge.kind)).toEqual(["certificate", "vote"]);
  });
});

describe("buildTxGovernanceBadgeMap", () => {
  it("returns an empty map for no items", () => {
    expect(buildTxGovernanceBadgeMap([]).size).toBe(0);
  });

  it("keys by lowercased tx hash and groups certs plus votes", () => {
    const MIXED_CASE_TX = "AB".repeat(32);
    const map = buildTxGovernanceBadgeMap([
      govItem({
        txHash: MIXED_CASE_TX,
        certs: [{ type: "drep_registration", drepId: null }],
        votes: [govVote({ voteKind: "Yes" }), govVote({ voteKind: "No", proposalIndex: 1 })],
      }),
    ]);
    expect(map.get(MIXED_CASE_TX)).toBeUndefined();
    const badges = map.get(MIXED_CASE_TX.toLowerCase())!;
    expect(badges.map((badge) => badge.label)).toEqual([
      "DRep Registration",
      "Vote: Yes",
      "Vote: No",
    ]);
  });

  it("omits items whose certs all filter out", () => {
    const map = buildTxGovernanceBadgeMap([
      govItem({ certs: [{ type: "stake_registration", drepId: null }] }),
    ]);
    expect(map.size).toBe(0);
  });
});
