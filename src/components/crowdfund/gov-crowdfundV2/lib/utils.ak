use aiken/cbor
use aiken/collection/list
use aiken/collection/pairs.{get_first}
use cardano/address.{Address, Credential, from_script}
use cardano/assets.{Lovelace, PolicyId, from_lovelace, lovelace_of}
use cardano/certificate.{
  Certificate, DelegateBlockProduction, DelegateBoth, DelegateCredential,
  DelegateRepresentative, DelegateVote, RegisterCredential,
  RegisterDelegateRepresentative, StakePoolId, UnregisterCredential,
  UnregisterDelegateRepresentative,
}
use cardano/governance.{
  GovernanceAction, GovernanceActionId, ProposalProcedure, Vote, Voter, Yes,
}
use cardano/transaction.{Input, Output, Redeemer, ScriptPurpose, Spend}
use cocktail.{inputs_at, inputs_with_policy}
use types.{CrowdfundGovRedeemer}

pub fn check_fundraise_target(
  allow_over_subscription: Bool,
  fundraise_target: Int,
  current_fundraised_amount: Int,
) -> Bool {
  if allow_over_subscription {
    True
  } else {
    current_fundraised_amount <= fundraise_target
  }
}

pub fn outputs_at_with_lovelace(
  outputs: List<Output>,
  address: Address,
  lovelace: Lovelace,
) -> List<Output> {
  list.filter(
    outputs,
    fn(output) {
      let is_lovelace_match = output.value == from_lovelace(lovelace)
      is_lovelace_match && output.address == address
    },
  )
}

pub fn redeemer_with_input(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  input: Input,
) -> Option<Data> {
  let output_reference = input.output_reference
  redeemers |> pairs.get_first(Spend(output_reference))
}

// Combined certificate check - processes certificates list only once
// Returns True if all four certificates are found and correct
pub fn check_register_certs(
  certificates: List<Certificate>,
  credential: Credential,
  drep_deposit: Lovelace,
  stake_pool: StakePoolId,
  delegate_representative: DelegateRepresentative,
) -> Bool {
  let (has_stake_reg, has_drep_reg, has_block_delegate, has_vote_delegate) =
    list.foldl(
      certificates,
      (False, False, False, False),
      fn(cert: Certificate, acc: (Bool, Bool, Bool, Bool)) {
        let (has_stake_reg, has_drep_reg, has_block_delegate, has_vote_delegate) =
          acc
        when cert is {
          RegisterCredential { credential: c, deposit: Never } ->
            if c == credential {
              trace @"register stake certificate found"
              (True, has_drep_reg, has_block_delegate, has_vote_delegate)
            } else {
              acc
            }
          RegisterDelegateRepresentative {
            delegate_representative: drep_cred,
            deposit: dep,
          } ->
            if drep_cred == credential && dep == drep_deposit {
              trace @"register drep certificate found"
              (has_stake_reg, True, has_block_delegate, has_vote_delegate)
            } else {
              acc
            }
          DelegateCredential {
            credential: c,
            delegate: DelegateBlockProduction { stake_pool: sp },
          } ->
            if c == credential && sp == stake_pool {
              trace @"delegate stake certificate found"
              (has_stake_reg, has_drep_reg, True, has_vote_delegate)
            } else {
              acc
            }
          DelegateCredential {
            credential: c,
            delegate: DelegateVote { delegate_representative: dr },
          } ->
            if c == credential && dr == delegate_representative {
              trace @"delegate vote certificate found"
              (has_stake_reg, has_drep_reg, has_block_delegate, True)
            } else {
              acc
            }
          DelegateCredential {
            credential: c,
            delegate: DelegateBoth {
              stake_pool: sp,
              delegate_representative: dr,
            },
          } ->
            if c == credential && sp == stake_pool && dr == delegate_representative {
              trace @"delegate both stake and vote certificate found"
              (has_stake_reg, has_drep_reg, True, True)
            } else {
              acc
            }
          _ -> acc
        }
      },
    )
  has_stake_reg && has_drep_reg && has_block_delegate && has_vote_delegate
}

// Individual functions kept for backward compatibility and other use cases
pub fn register_stake_certificate(
  certificates: List<Certificate>,
  credential: Credential,
) {
  list.has(certificates, RegisterCredential { credential, deposit: Never })
}

pub fn register_drep_certificate(
  certificates: List<Certificate>,
  credential: Credential,
  deposit: Lovelace,
) {
  list.has(
    certificates,
    RegisterDelegateRepresentative {
      delegate_representative: credential,
      deposit,
    },
  )
}

pub fn delegate_stake_certificate(
  certificates: List<Certificate>,
  credential: Credential,
  stake_pool: StakePoolId,
) {
  list.has(
    certificates,
    DelegateCredential {
      credential,
      delegate: DelegateBlockProduction { stake_pool },
    },
  )
}

pub fn delegate_vote_certificate(
  certificates: List<Certificate>,
  credential: Credential,
  delegate_representative: DelegateRepresentative,
) {
  list.has(
    certificates,
    DelegateCredential {
      credential,
      delegate: DelegateVote { delegate_representative },
    },
  )
}

pub fn delegate_stake_and_vote_certificate(
  certificates: List<Certificate>,
  credential: Credential,
  stake_pool: StakePoolId,
  delegate_representative: DelegateRepresentative,
) {
  list.has(
    certificates,
    DelegateCredential {
      credential,
      delegate: DelegateBoth { stake_pool, delegate_representative },
    },
  )
}

pub fn unregister_stake_certificate(
  certificates: List<Certificate>,
  credential: Credential,
) {
  list.has(certificates, UnregisterCredential { credential, refund: Never })
}

pub fn unregister_drep_certificate(
  certificates: List<Certificate>,
  credential: Credential,
  refund: Lovelace,
) {
  list.has(
    certificates,
    UnregisterDelegateRepresentative {
      delegate_representative: credential,
      refund,
    },
  )
}

pub fn check_lovelace_diff(input: Input, output: Output, diff: Lovelace) {
  let lovelace_from_input_output = input.output.value |> lovelace_of()
  let lovelace_from_output = output.value |> lovelace_of()

  lovelace_from_output - lovelace_from_input_output == diff
}

pub fn check_spend_script_input_redeemer(
  spend: ByteArray,
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  redeemer: CrowdfundGovRedeemer,
) {
  let spend_address = from_script(spend)
  expect [only_input] = inputs_at(inputs, spend_address)
  expect Some(only_input_redeemer_data) =
    redeemer_with_input(redeemers, only_input)

  expect only_input_redeemer: CrowdfundGovRedeemer = only_input_redeemer_data

  only_input_redeemer == redeemer
}

pub fn check_auth_token_input_redeemer(
  auth_token: PolicyId,
  inputs: List<Input>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  redeemer: CrowdfundGovRedeemer,
) {
  expect [only_input] = inputs_with_policy(inputs, auth_token)
  expect Some(only_input_redeemer_data) =
    redeemer_with_input(redeemers, only_input)

  expect only_input_redeemer: CrowdfundGovRedeemer = only_input_redeemer_data

  only_input_redeemer == redeemer
}

pub fn compare_gov_action(agov: GovernanceAction, vgov: ByteArray) {
  let se_agov = cbor.serialise(agov)
  se_agov == vgov
}

pub fn check_proposal_procedure(
  proposal_procedures: List<ProposalProcedure>,
  deposit: Lovelace,
  return_address: Credential,
  vgovernance_action: ByteArray,
) {
  list.count(
    proposal_procedures,
    fn(proposal_procedure) {
      proposal_procedure.deposit == deposit && proposal_procedure.return_address == return_address && compare_gov_action(
        proposal_procedure.governance_action,
        vgovernance_action,
      )
    },
  ) == 1
}

pub fn check_vote(
  votes: Pairs<Voter, Pairs<GovernanceActionId, Vote>>,
  drep: Voter,
  gov_tx_id: GovernanceActionId,
) {
  let value_list = get_first(votes, drep)

  expect Some(gov_pair) = value_list
  list.has(gov_pair, Pair(gov_tx_id, Yes))
}
