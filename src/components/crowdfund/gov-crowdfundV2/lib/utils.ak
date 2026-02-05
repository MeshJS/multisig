use aiken/builtin
use aiken/cbor
use aiken/collection/list
use aiken/collection/pairs.{get_first}
use aiken/crypto.{ScriptHash}
use aiken/option
use cardano/address.{
  Address, Credential, Inline, Script, VerificationKey, from_script,
}
use cardano/assets.{Lovelace, PolicyId, from_lovelace, lovelace_of}
use cardano/certificate.{
  AlwaysAbstain, AlwaysNoConfidence, Certificate, DelegateBlockProduction,
  DelegateBoth, DelegateCredential, DelegateRepresentative, DelegateVote,
  RegisterAndDelegateCredential, RegisterCredential,
  RegisterDelegateRepresentative, Registered, StakePoolId, UnregisterCredential,
  UnregisterDelegateRepresentative,
}
use cardano/governance.{
  GovernanceAction, GovernanceActionId, NicePoll, ProposalProcedure,
  TreasuryWithdrawal, Vote, Voter, Yes,
}
use cardano/transaction.{Input, Output, Redeemer, ScriptPurpose, Spend}
use cocktail.{
  inputs_at, inputs_at_with, inputs_with_policy, output_inline_datum,
  outputs_at_with, value_length,
}
use gov.{VGovernanceAction, VNicePoll, VTreasuryWithdrawal}
use types.{CrowdfundGovDatum, CrowdfundGovRedeemer}

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

pub fn register_stake_certificate(
  certificates: List<Certificate>,
  credential: Credential,
) {
  // Extract hash from expected credential (works for both Script and VerificationKey)
  let expected_hash =
    when credential is {
      Script(h) -> h
      VerificationKey(h) -> h
    }
  // Check for certificate with matching hash (ignoring credential type mismatch)
  list.any(
    certificates,
    fn(cert) {
      when cert is {
        RegisterCredential { credential: c, .. } ->
          when c is {
            Script(h) -> h == expected_hash
            VerificationKey(h) -> h == expected_hash
          }
        RegisterAndDelegateCredential { credential: c, .. } ->
          when c is {
            Script(h) -> h == expected_hash
            VerificationKey(h) -> h == expected_hash
          }
        _ -> False
      }
    },
  )
}

pub fn register_drep_certificate(
  certificates: List<Certificate>,
  credential: Credential,
  deposit: Lovelace,
) {
  // Extract hash from expected credential
  let expected_hash =
    when credential is {
      Script(h) -> h
      VerificationKey(h) -> h
    }
  list.any(
    certificates,
    fn(cert) {
      when cert is {
        RegisterDelegateRepresentative {
          delegate_representative: c,
          deposit: d,
        } ->
          d == deposit && when c is {
            Script(h) -> h == expected_hash
            VerificationKey(h) -> h == expected_hash
          }
        _ -> False
      }
    },
  )
}

pub fn delegate_stake_certificate(
  certificates: List<Certificate>,
  credential: Credential,
  stake_pool: StakePoolId,
) {
  let expected_hash =
    when credential is {
      Script(h) -> h
      VerificationKey(h) -> h
    }
  list.any(
    certificates,
    fn(cert) {
      when cert is {
        DelegateCredential {
          credential: c,
          delegate: DelegateBlockProduction { stake_pool: sp },
        } ->
          sp == stake_pool && when c is {
            Script(h) -> h == expected_hash
            VerificationKey(h) -> h == expected_hash
          }
        _ -> False
      }
    },
  )
}

pub fn delegate_vote_certificate(
  certificates: List<Certificate>,
  credential: Credential,
  delegate_representative: DelegateRepresentative,
) {
  let expected_hash =
    when credential is {
      Script(h) -> h
      VerificationKey(h) -> h
    }
  list.any(
    certificates,
    fn(cert) {
      when cert is {
        DelegateCredential {
          credential: c,
          delegate: DelegateVote { delegate_representative: dr },
        } ->
          delegate_representatives_match(
            dr,
            delegate_representative,
            expected_hash,
          ) && when c is {
            Script(h) -> h == expected_hash
            VerificationKey(h) -> h == expected_hash
          }
        _ -> False
      }
    },
  )
}

pub fn delegate_stake_and_vote_certificate(
  certificates: List<Certificate>,
  credential: Credential,
  stake_pool: StakePoolId,
  delegate_representative: DelegateRepresentative,
) {
  let expected_hash =
    when credential is {
      Script(h) -> h
      VerificationKey(h) -> h
    }
  list.any(
    certificates,
    fn(cert) {
      when cert is {
        DelegateCredential {
          credential: c,
          delegate: DelegateBoth { stake_pool: sp, delegate_representative: dr },
        } ->
          sp == stake_pool && delegate_representatives_match(
            dr,
            delegate_representative,
            expected_hash,
          ) && when c is {
            Script(h) -> h == expected_hash
            VerificationKey(h) -> h == expected_hash
          }
        _ -> False
      }
    },
  )
}

// Helper to compare DelegateRepresentative with hash-based credential matching
fn delegate_representatives_match(
  actual: DelegateRepresentative,
  expected: DelegateRepresentative,
  expected_hash: ByteArray,
) -> Bool {
  when (actual, expected) is {
    (Registered(c1), Registered(_)) ->
      when c1 is {
        Script(h) -> h == expected_hash
        VerificationKey(h) -> h == expected_hash
      }
    (AlwaysAbstain, AlwaysAbstain) -> True
    (AlwaysNoConfidence, AlwaysNoConfidence) -> True
    _ -> False
  }
}

pub fn unregister_stake_certificate(
  certificates: List<Certificate>,
  credential: Credential,
) {
  let expected_hash =
    when credential is {
      Script(h) -> h
      VerificationKey(h) -> h
    }
  list.any(
    certificates,
    fn(cert) {
      when cert is {
        UnregisterCredential { credential: c, .. } ->
          when c is {
            Script(h) -> h == expected_hash
            VerificationKey(h) -> h == expected_hash
          }
        _ -> False
      }
    },
  )
}

pub fn unregister_drep_certificate(
  certificates: List<Certificate>,
  credential: Credential,
  refund: Lovelace,
) {
  let expected_hash =
    when credential is {
      Script(h) -> h
      VerificationKey(h) -> h
    }
  list.any(
    certificates,
    fn(cert) {
      when cert is {
        UnregisterDelegateRepresentative {
          delegate_representative: c,
          refund: r,
        } ->
          r == refund && when c is {
            Script(h) -> h == expected_hash
            VerificationKey(h) -> h == expected_hash
          }
        _ -> False
      }
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

// Decode Plutus Data (parametrized gov_action bytes) into VGovernanceAction.
// Supports constructor 2 (VTreasuryWithdrawal) and 6 (VNicePoll) only.
fn decode_vgov(bytes: ByteArray) -> Option<VGovernanceAction> {
  let none_vgov: Option<VGovernanceAction> = None
  cbor.deserialise(bytes)
    |> option.and_then(
        fn(d) {
          builtin.choose_data(
            d,
            {
              let Pair(ix, fields) = builtin.un_constr_data(d)
              if ix == 2 {
                when fields is {
                  [beneficiaries_data, guardrails_data] ->
                    decode_beneficiaries_list(beneficiaries_data)
                      |> option.and_then(
                          fn(bens) {
                            decode_option_script_hash(guardrails_data)
                              |> option.map(
                                  fn(guard) {
                                    VTreasuryWithdrawal {
                                      beneficiaries: bens,
                                      guardrails: guard,
                                    }
                                  },
                                )
                          },
                        )
                  _ -> none_vgov
                }
              } else if ix == 6 {
                when fields is {
                  [] -> Some(VNicePoll)
                  _ -> none_vgov
                }
              } else {
                none_vgov
              }
            },
            { none_vgov },
            { none_vgov },
            { none_vgov },
            { none_vgov },
          )
        },
      )
}

fn decode_credential(d: Data) -> Option<Credential> {
  let none_cred: Option<Credential> = None
  builtin.choose_data(
    d,
    {
      let Pair(ix, fields) = builtin.un_constr_data(d)
      when fields is {
        [h] ->
          if ix == 0 {
            // Only call un_b_data(h) when h is confirmed bytearray (defensive guard).
            builtin.choose_data(
              h,
              { none_cred },
              { none_cred },
              { none_cred },
              { none_cred },
              {
                builtin.choose_data(
                  h,
                  { none_cred },
                  { none_cred },
                  { none_cred },
                  { none_cred },
                  { Some(VerificationKey(builtin.un_b_data(h))) },
                )
              },
            )
          } else if ix == 1 {
            builtin.choose_data(
              h,
              { none_cred },
              { none_cred },
              { none_cred },
              { none_cred },
              {
                builtin.choose_data(
                  h,
                  { none_cred },
                  { none_cred },
                  { none_cred },
                  { none_cred },
                  { Some(Script(builtin.un_b_data(h))) },
                )
              },
            )
          } else {
            none_cred
          }
        _ -> none_cred
      }
    },
    { none_cred },
    { none_cred },
    { none_cred },
    { none_cred },
  )
}

fn decode_lovelace(d: Data) -> Option<Lovelace> {
  let none_lov: Option<Lovelace> = None
  builtin.choose_data(
    d,
    { none_lov },
    { none_lov },
    { none_lov },
    { Some(builtin.un_i_data(d)) },
    { none_lov },
  )
}

// Only call un_b_data when d is confirmed bytearray (nested choose_data) to avoid
// unBData(Constr) if runtime branch order differs from (constr, map, list, int, bytearray).
fn decode_script_hash(d: Data) -> Option<ScriptHash> {
  let none_hash: Option<ScriptHash> = None
  builtin.choose_data(
    d,
    { none_hash },
    { none_hash },
    { none_hash },
    { none_hash },
    {
      builtin.choose_data(
        d,
        { none_hash },
        { none_hash },
        { none_hash },
        { none_hash },
        { Some(builtin.un_b_data(d)) },
      )
    },
  )
}

fn decode_option_script_hash(d: Data) -> Option<Option<ScriptHash>> {
  let none_opt: Option<Option<ScriptHash>> = None
  builtin.choose_data(
    d,
    {
      let Pair(ix, fields) = builtin.un_constr_data(d)
      when fields is {
        [] ->
          if ix == 1 {
            Some(None)
          } else {
            none_opt
          }
        [x] ->
          if ix == 0 {
            decode_script_hash(x) |> option.map(fn(h) { Some(h) })
          } else {
            none_opt
          }
        _ -> none_opt
      }
    },
    { none_opt },
    { none_opt },
    { none_opt },
    { none_opt },
  )
}

fn decode_beneficiary_pair(d: Data) -> Option<Pair<Credential, Lovelace>> {
  let none_pair: Option<Pair<Credential, Lovelace>> = None
  builtin.choose_data(
    d,
    {
      let Pair(ix, fields) = builtin.un_constr_data(d)
      if ix == 0 {
        when fields is {
          [c_data, l_data] ->
            decode_credential(c_data)
              |> option.and_then(
                  fn(c) {
                    decode_lovelace(l_data)
                      |> option.map(fn(l) { Pair(c, l) })
                  },
                )
          _ -> none_pair
        }
      } else {
        none_pair
      }
    },
    { none_pair },
    { none_pair },
    { none_pair },
    { none_pair },
  )
}

fn decode_beneficiaries_list_impl(
  lst: List<Data>,
) -> Option<List<Pair<Credential, Lovelace>>> {
  when lst is {
    [] -> Some([])
    [x, ..rest] ->
      decode_beneficiary_pair(x)
        |> option.and_then(
            fn(p) {
              decode_beneficiaries_list_impl(rest)
                |> option.map(fn(ps) { [p, ..ps] })
            },
          )
  }
}

fn decode_beneficiaries_list(
  d: Data,
) -> Option<List<Pair<Credential, Lovelace>>> {
  let none_list: Option<List<Pair<Credential, Lovelace>>> = None
  builtin.choose_data(
    d,
    { none_list },
    { none_list },
    { decode_beneficiaries_list_impl(builtin.un_list_data(d)) },
    { none_list },
    { none_list },
  )
}

/// Convert tx GovernanceAction to VGovernanceAction for supported variants only.
fn governance_action_to_vgov(
  agov: GovernanceAction,
) -> Option<VGovernanceAction> {
  when agov is {
    TreasuryWithdrawal { beneficiaries, guardrails } ->
      Some(VTreasuryWithdrawal { beneficiaries, guardrails })
    NicePoll -> Some(VNicePoll)
    _ -> None
  }
}

/// Compare parametrized gov_action (Plutus Data bytes) with tx proposal (GovernanceAction) structurally.
pub fn compare_gov_action(agov: GovernanceAction, vgov: ByteArray) {
  let v_from_param = decode_vgov(vgov)
  let v_from_tx = governance_action_to_vgov(agov)
  option.or_else(
    v_from_param
      |> option.and_then(
          fn(vp) { v_from_tx |> option.map(fn(vt) { vp == vt }) },
        ),
    False,
  )
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

/// Extract inline stake credential from an address
pub fn get_inline_credential(address: Address) -> Credential {
  expect Some(stake_credential) = address.stake_credential
  expect Inline(credential) = stake_credential
  credential
}

/// Get single input/output pair with auth token at address, extract output datum, and check value is clean
/// Returns (Input, Output, CrowdfundGovDatum, Bool) where Bool is whether output value has exactly 2 assets
pub fn get_single_auth_io(
  inputs: List<Input>,
  outputs: List<Output>,
  address: Address,
  auth_token: PolicyId,
) -> (Input, Output, CrowdfundGovDatum, Bool) {
  expect [only_input] = inputs_at_with(inputs, address, auth_token, "")
  expect [only_output] = outputs_at_with(outputs, address, auth_token, "")
  expect only_output_datum: CrowdfundGovDatum = output_inline_datum(only_output)
  let is_output_value_clean = value_length(only_output.value) == 2
  (only_input, only_output, only_output_datum, is_output_value_clean)
}
