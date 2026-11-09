import { csl } from "@meshsdk/core-csl";
import type { Certificate, Vote } from "@meshsdk/core";
import type { DrepVoteContext } from "@/lib/governance/drep-context";
import type { StakeCertContext } from "@/lib/staking/stake-context";
import { networkId } from "@/lib/tx-risk/classify";

export type PendingGovernanceContext = {
  stake?: StakeCertContext;
  drep?: DrepVoteContext;
};

/** Decode the existing supported native staking/voting subset, retaining order
 * and anchors. Check the identity the builder will actually use on rebuilding. */
export function readPendingGovernance(
  body: csl.TransactionBody,
  native: csl.NativeScript[],
  context: PendingGovernanceContext & { network: number },
): { certificates: Certificate[]; votes: Vote[] } {
  const certificates: Certificate[] = [];
  const votes: Vote[] = [];
  const hasWitness = (hash: string) =>
    native.some((script) => script.hash().to_hex() === hash);
  const certs = body.certs();
  for (let i = 0; i < (certs?.len() ?? 0); i++) {
    const cert = certs!.get(i);
    const register = cert.as_stake_registration();
    const deregister = cert.as_stake_deregistration();
    const delegate = cert.as_stake_delegation();
    const vote = cert.as_vote_delegation();
    const supported = register ?? deregister ?? delegate ?? vote;
    if (!supported)
      throw new Error(
        "Contains certificate types not supported by the builder.",
      );
    // The editor has no deposit/refund control. Mesh emits the legacy forms.
    if (register?.coin() || deregister?.coin())
      throw new Error(
        "Explicit certificate deposits or refunds cannot be preserved by the builder.",
      );
    const credential = supported.stake_credential();
    const hash = credential.to_scripthash()?.to_hex();
    const reward = csl.RewardAddress.new(networkId(context.network), credential)
      .to_address()
      .to_bech32();
    const expected = context.stake;
    if (
      !hash ||
      !expected ||
      expected.rewardAddress !== reward ||
      csl.NativeScript.from_hex(expected.stakeScriptCbor).hash().to_hex() !==
        hash ||
      (cert.has_required_script_witness() && !hasWitness(hash))
    )
      throw new Error(
        "Certificate identity or native witness does not match this wallet's staking context.",
      );
    let certType: Certificate["certType"];
    if (register) certType = { type: "RegisterStake", stakeKeyAddress: reward };
    else if (deregister)
      certType = { type: "DeregisterStake", stakeKeyAddress: reward };
    else if (delegate)
      certType = {
        type: "DelegateStake",
        stakeKeyAddress: reward,
        poolId: delegate.pool_keyhash().to_hex(),
      };
    else {
      const drep = vote!.drep();
      if (drep.kind() === csl.DRepKind.AlwaysNoConfidence)
        throw new Error(
          "No-confidence vote delegation is not supported by the builder.",
        );
      certType = {
        type: "VoteDelegation",
        stakeKeyAddress: reward,
        drep:
          drep.kind() === csl.DRepKind.AlwaysAbstain
            ? { alwaysAbstain: null }
            : { dRepId: drep.to_bech32(true) },
      };
    }
    certificates.push({ type: "BasicCertificate", certType });
  }
  const procedures = body.voting_procedures();
  const voters = procedures?.get_voters();
  for (let i = 0; i < (voters?.len() ?? 0); i++) {
    const voter = voters!.get(i)!;
    const credential = voter.to_drep_credential();
    const hash = credential?.to_scripthash()?.to_hex();
    const expected = context.drep;
    if (
      !hash ||
      !credential ||
      !expected ||
      csl.DRep.from_bech32(expected.dRepId).to_script_hash()?.to_hex() !==
        hash ||
      csl.NativeScript.from_hex(expected.drepScriptCbor).hash().to_hex() !==
        hash ||
      !hasWitness(hash)
    )
      throw new Error(
        "Only native DRep votes matching this wallet's voting identity can be edited.",
      );
    const ids = procedures!.get_governance_action_ids_by_voter(voter);
    for (let j = 0; j < ids.len(); j++) {
      const id = ids.get(j)!;
      const procedure = procedures!.get(voter, id)!;
      const anchor = procedure.anchor();
      const voteKind = (["No", "Yes", "Abstain"] as const)[
        procedure.vote_kind()
      ];
      if (!voteKind) throw new Error("Unsupported vote kind.");
      votes.push({
        type: "BasicVote",
        vote: {
          voter: { type: "DRep", drepId: expected.dRepId },
          govActionId: {
            txHash: id.transaction_id().to_hex(),
            txIndex: id.index(),
          },
          votingProcedure: {
            voteKind,
            ...(anchor
              ? {
                  anchor: {
                    anchorUrl: anchor.url().url(),
                    anchorDataHash: anchor.anchor_data_hash().to_hex(),
                  },
                }
              : {}),
          },
        },
      });
    }
  }
  return { certificates, votes };
}
