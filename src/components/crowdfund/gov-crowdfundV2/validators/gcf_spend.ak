use aiken/collection/list
use cardano/address.{Script, VerificationKey}
use cardano/assets.{Lovelace, PolicyId, lovelace_of}
use cardano/certificate.{Registered}
use cardano/governance.{DelegateRepresentative, GovernanceActionId}
use cardano/transaction.{OutputReference, Transaction, find_input}
use cocktail.{
  inputs_at_with, inputs_at_with_policy, key_signed, only_minted_token,
  output_inline_datum, outputs_at_with_policy, policy_only_minted_token,
  valid_after, valid_before, value_length,
}
use types.{
  ContributeFund, ContributorWithdrawal, Crowdfund, CrowdfundGovDatum,
  CrowdfundGovRedeemer, DeregisterCerts, ProposeGovAction, Proposed, Refundable,
  RegisterCerts, RemoveEmptyInstance, VoteOnGovAction, Voted,
}
use utils.{
  check_fundraise_target, check_lovelace_diff, check_proposal_procedure,
  check_vote, delegate_stake_and_vote_certificate, delegate_stake_certificate,
  delegate_vote_certificate, get_inline_credential, get_single_auth_io,
  register_drep_certificate, register_stake_certificate,
  unregister_drep_certificate, unregister_stake_certificate,
}

// Unified spending validator handling both crowdfunding and governance operations
validator gCf_spend(
  auth_token: PolicyId,
  proposer_key_hash: ByteArray,
  gov_action: ByteArray,
  delegate_pool_id: ByteArray,
  // dynamic deposit parameters to avoid hardcoding values
  stake_register_deposit: Lovelace,
  drep_register_deposit: Lovelace,
  gov_deposit: Lovelace,
) {
  spend(
    datum_opt: Option<CrowdfundGovDatum>,
    redeemer: CrowdfundGovRedeemer,
    input: OutputReference,
    self: Transaction,
  ) {
    let Transaction {
      inputs,
      validity_range,
      mint,
      outputs,
      extra_signatories,
      certificates,
      proposal_procedures,
      votes,
      ..
    } = self

    expect Some(own_input) = find_input(inputs, input)
    expect Some(auth_input_datum) = datum_opt

    let current_address = own_input.output.address

    // check only 1 auth token input from current address
    expect [auth_input] =
      inputs_at_with_policy(inputs, current_address, auth_token)

    when redeemer is {
      // Crowdfunding: Add funds to active campaign, mint proportional share tokens
      ContributeFund ->
        when auth_input_datum is {
          Crowdfund {
            stake_hash,
            share_token,
            crowdfund_address,
            fundraise_target,
            current_fundraised_amount: input_current_fundraised_amount,
            allow_over_subscription,
            deadline,
            expiry_buffer,
            min_charge,
          } -> {
            expect [auth_output] =
              outputs_at_with_policy(outputs, current_address, auth_token)

            let lovelace_from_auth_input =
              auth_input.output.value |> lovelace_of()
            let lovelace_from_auth_output = auth_output.value |> lovelace_of()
            expect auth_output_datum_raw: CrowdfundGovDatum =
              output_inline_datum(auth_output)

            when auth_output_datum_raw is {
              Crowdfund {
                current_fundraised_amount: output_current_fundraised_amount,
                ..
              } -> {
                let fundraise_added =
                  lovelace_from_auth_output - lovelace_from_auth_input
                let fundraise_check =
                  (fundraise_added == output_current_fundraised_amount - input_current_fundraised_amount)? && (fundraise_added >= 2000000)?

                let fundraise_target_check =
                  check_fundraise_target(
                    allow_over_subscription,
                    fundraise_target,
                    output_current_fundraised_amount,
                  )

                let validity_check = valid_before(validity_range, deadline)

                let output_datum_check =
                  auth_output_datum_raw == Crowdfund {
                    stake_hash,
                    share_token,
                    crowdfund_address,
                    fundraise_target,
                    current_fundraised_amount: input_current_fundraised_amount + fundraise_added,
                    allow_over_subscription,
                    deadline,
                    expiry_buffer,
                    min_charge,
                  }

                let is_auth_output_value_clean =
                  value_length(auth_output.value) == 2
                fundraise_check? && fundraise_target_check? && validity_check? && output_datum_check? && is_auth_output_value_clean? && only_minted_token(
                  mint,
                  share_token,
                  "",
                  fundraise_added,
                )?
              }
              _ -> False
            }
          }
          _ -> False
        }

      // Withdraw funds: handles both Crowdfund (failed/expired campaign) and Refundable (post-governance)
      ContributorWithdrawal -> {
        // Common: get single output with auth token
        expect [auth_output] =
          outputs_at_with_policy(outputs, current_address, auth_token)

        // Common: calculate withdrawal amount
        let lovelace_from_auth_input = auth_input.output.value |> lovelace_of()
        let lovelace_from_auth_output = auth_output.value |> lovelace_of()
        let lovelace_withdrawn =
          lovelace_from_auth_output - lovelace_from_auth_input

        // Common: verify withdrawal is negative and output value is clean
        let lovelace_withdrawn_check = lovelace_withdrawn < 0
        let is_auth_output_value_clean = value_length(auth_output.value) == 2

        expect auth_output_datum: CrowdfundGovDatum =
          output_inline_datum(auth_output)

        // Extract share_token and build expected output datum based on input datum type
        let (share_token, eligibility_check, output_datum_check) =
          when auth_input_datum is {
            Crowdfund {
              stake_hash,
              share_token,
              crowdfund_address,
              fundraise_target,
              current_fundraised_amount,
              allow_over_subscription,
              deadline,
              expiry_buffer,
              min_charge,
            } -> {
              let validity_check =
                valid_after(validity_range, deadline + expiry_buffer)
              let fund_check = current_fundraised_amount <= fundraise_target
              let expected_datum =
                Crowdfund {
                  stake_hash,
                  share_token,
                  crowdfund_address,
                  fundraise_target,
                  current_fundraised_amount: current_fundraised_amount + lovelace_withdrawn,
                  allow_over_subscription,
                  deadline,
                  expiry_buffer,
                  min_charge,
                }
              (
                share_token,
                validity_check || fund_check,
                auth_output_datum == expected_datum,
              )
            }
            Refundable { stake_hash, share_token, funds_controlled } -> {
              let expected_datum =
                Refundable {
                  stake_hash,
                  share_token,
                  funds_controlled: funds_controlled + lovelace_withdrawn,
                }
              (share_token, True, auth_output_datum == expected_datum)
            }
            _ -> ("", False, False)
          }

        eligibility_check? && lovelace_withdrawn_check? && output_datum_check? && is_auth_output_value_clean? && only_minted_token(
          mint,
          share_token,
          "",
          lovelace_withdrawn,
        )?
      }

      // Governance: Register certificates and propose (Crowdfund → Crowdfund) - combines RegisterStake, RegisterDrep, and ProposeGovAction
      RegisterCerts ->
        when auth_input_datum is {
          Crowdfund { stake_hash, .. } -> {
            let (only_input, only_output, only_output_datum, is_value_clean) =
              get_single_auth_io(inputs, outputs, current_address, auth_token)
            let current_credential = get_inline_credential(current_address)
            // The stake credential could be Script or VerificationKey depending on address construction
            let credential_hash =
              when current_credential is {
                Script(h) -> h
                VerificationKey(h) -> h
              }
            let credential_matches_datum = credential_hash == stake_hash

            let lovelace_check =
              check_lovelace_diff(
                only_input,
                only_output,
                -(stake_register_deposit + drep_register_deposit),
              )
            let output_datum_check = only_output_datum == auth_input_datum

            let reg_stake_cert_check =
              register_stake_certificate(certificates, current_credential)
            let reg_drep_cert_check =
              register_drep_certificate(
                certificates,
                current_credential,
                drep_register_deposit,
              )
            let delegate_vote_check =
              delegate_vote_certificate(
                certificates,
                current_credential,
                Registered(current_credential),
              )
            let delegate_stake_check =
              delegate_stake_certificate(
                certificates,
                current_credential,
                delegate_pool_id,
              )
            let delegate_both_check =
              delegate_stake_and_vote_certificate(
                certificates,
                current_credential,
                delegate_pool_id,
                Registered(current_credential),
              )
            let delegate_check =
              delegate_vote_check? && delegate_stake_check? || delegate_both_check

            // RegisterCerts must be used with a proposal (same tx must include proposal_procedures)
            let proposal_present = !list.is_empty(proposal_procedures)

            credential_matches_datum? && lovelace_check? && output_datum_check? && is_value_clean? && reg_stake_cert_check? && reg_drep_cert_check? && delegate_check? && proposal_present?
          }
          _ -> False
        }

      // Governance: Submit governance proposal (Crowdfund → Proposed)
      ProposeGovAction ->
        when auth_input_datum is {
          Crowdfund {
            stake_hash,
            share_token,
            current_fundraised_amount,
            deadline,
            ..
          } -> {
            let (only_input, only_output, only_output_datum, is_value_clean) =
              get_single_auth_io(inputs, outputs, current_address, auth_token)

            let lovelace_check =
              check_lovelace_diff(only_input, only_output, -gov_deposit)
            let output_datum_check =
              only_output_datum == Proposed {
                stake_hash,
                share_token,
                funds_controlled: current_fundraised_amount,
                deadline,
              }
            let proposal_check =
              check_proposal_procedure(
                proposal_procedures,
                gov_deposit,
                Script(stake_hash),
                gov_action,
              )

            lovelace_check? && output_datum_check? && is_value_clean? && proposal_check?
          }
          _ -> False
        }

      // Governance: Record vote on proposal (Proposed → Voted)
      VoteOnGovAction ->
        when auth_input_datum is {
          Proposed { stake_hash, share_token, funds_controlled, deadline } -> {
            let (only_input, only_output, only_output_datum, is_value_clean) =
              get_single_auth_io(inputs, outputs, current_address, auth_token)

            let value_check = only_input.output.value == only_output.value
            let gov_tx_id =
              GovernanceActionId {
                transaction: own_input.output_reference.transaction_id,
                proposal_procedure: 0,
              }
            let output_datum_check =
              only_output_datum == Voted {
                stake_hash,
                share_token,
                funds_controlled,
                gov_tx_id,
                deadline,
              }

            value_check? && output_datum_check? && is_value_clean? && check_vote(
              votes,
              DelegateRepresentative(Script(stake_hash)),
              gov_tx_id,
            )
          }
          _ -> False
        }

      // Governance: Deregister certificates after governance period (Voted → Refundable)
      DeregisterCerts ->
        when auth_input_datum is {
          Voted { stake_hash, share_token, funds_controlled, deadline, .. } -> {
            let (only_input, only_output, only_output_datum, is_value_clean) =
              get_single_auth_io(inputs, outputs, current_address, auth_token)
            let current_credential = get_inline_credential(current_address)

            let validity_check = valid_after(validity_range, deadline)
            let lovelace_check =
              check_lovelace_diff(
                only_input,
                only_output,
                stake_register_deposit + drep_register_deposit + gov_deposit,
              )
            let output_datum_check =
              only_output_datum == Refundable {
                stake_hash,
                share_token,
                funds_controlled,
              }
            let unreg_stake_cert_check =
              unregister_stake_certificate(certificates, current_credential)
            let unreg_drep_cert_check =
              unregister_drep_certificate(
                certificates,
                current_credential,
                drep_register_deposit,
              )

            validity_check? && lovelace_check? && output_datum_check? && unreg_stake_cert_check? && unreg_drep_cert_check? && is_value_clean?
          }
          _ -> False
        }

      // Remove empty instance: handles both Crowdfund (after deadline) and Refundable (after governance complete)
      RemoveEmptyInstance -> {
        // Common: proposer must sign
        let proposer_key_signed_check =
          key_signed(extra_signatories, proposer_key_hash)

        // Extract eligibility check, share_token, and amount to burn based on datum type
        let (eligibility_check, share_token, amount_to_burn) =
          when auth_input_datum is {
            Refundable { stake_hash, share_token, funds_controlled } -> {
              // Verify single input with stake_hash token
              expect [_] =
                inputs_at_with(inputs, current_address, stake_hash, "")
              (True, share_token, funds_controlled)
            }
            Crowdfund { share_token, current_fundraised_amount, deadline, .. } ->
              (
                valid_after(validity_range, deadline),
                share_token,
                current_fundraised_amount,
              )
            _ -> (False, "", 0)
          }

        // Common: burn share tokens (if any) and auth token
        let token_burnt_check =
          if amount_to_burn > 0 {
            policy_only_minted_token(mint, share_token, "", -amount_to_burn)
          } else {
            True
          }

        eligibility_check? && proposer_key_signed_check? && token_burnt_check? && policy_only_minted_token(
          mint,
          auth_token,
          "",
          -1,
        )?
      }
    }
  }

  else(_) {
    fail
  }
}
