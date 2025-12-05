use cardano/address.{Script}
use cardano/assets.{add, from_lovelace}
use cardano/certificate.{
  DelegateBlockProduction, DelegateCredential, DelegateVote, RegisterCredential,
  RegisterDelegateRepresentative, Registered,
}
use cardano/governance.{NicePoll, ProposalProcedure}
use cardano/transaction.{Transaction}
use gcf_spend as gcf_spend_validator
use mocktail.{
  add_certificate, complete, mock_tx_hash, mock_utxo_ref, mocktail_tx, tx_in,
  tx_in_inline_datum, tx_out, tx_out_inline_datum,
}
use tests/test_utils.{
  add_proposal_procedure, mock_auth_token, mock_crowdfund_address, mock_deadline,
  mock_delegate_pool_id, mock_drep_register_deposit, mock_fundraise_target,
  mock_funds_controlled, mock_gov_action, mock_gov_action_period,
  mock_gov_address, mock_gov_deposit, mock_proposer_key_hash, mock_share_token,
  mock_stake_hash, mock_stake_register_deposit,
}
use types.{Crowdfund, CrowdfundGovDatum, RegisterCerts}

// Test case for RegisterCerts with realistic data matching the user's input/output
fn mock_register_certs_tx_realistic(include_proposal: Bool) -> Transaction {
  let input_value =
    from_lovelace(mock_funds_controlled)
      |> add(mock_stake_hash, "", 1)
      |> add(mock_auth_token, "", 1)

  let input_datum: CrowdfundGovDatum =
    Crowdfund {
      stake_hash: mock_stake_hash,
      share_token: mock_share_token,
      crowdfund_address: mock_crowdfund_address,
      fundraise_target: mock_fundraise_target,
      current_fundraised_amount: mock_funds_controlled,
      allow_over_subscription: False,
      deadline: mock_deadline + mock_gov_action_period,
      expiry_buffer: 3600 * 24,
      min_charge: 10,
    }

  // Calculate output value based on deposits (only stake + drep, no gov deposit for RegisterCerts)
  let deposits = mock_stake_register_deposit + mock_drep_register_deposit
  // Output should only have lovelace + auth token (value_length == 2)
  let output_value =
    from_lovelace(mock_funds_controlled - deposits)
      |> add(mock_auth_token, "", 1)

  // RegisterCerts keeps the same Crowdfund datum (no state transition, just deducts deposits)
  let output_datum: CrowdfundGovDatum =
    Crowdfund {
      stake_hash: mock_stake_hash,
      share_token: mock_share_token,
      crowdfund_address: mock_crowdfund_address,
      fundraise_target: mock_fundraise_target,
      current_fundraised_amount: mock_funds_controlled,
      allow_over_subscription: False,
      deadline: mock_deadline + mock_gov_action_period,
      expiry_buffer: 3600 * 24,
      min_charge: 10,
    }

  mocktail_tx()
    |> tx_in(True, mock_tx_hash(0), 0, input_value, mock_gov_address)
    |> tx_in_inline_datum(True, input_datum)
    |> tx_out(True, mock_gov_address, output_value)
    |> tx_out_inline_datum(True, output_datum)
    |> complete()
    |> add_certificate(
        True,
        RegisterCredential {
          credential: Script(mock_stake_hash),
          deposit: Never,
        },
      )
    |> add_certificate(
        True,
        RegisterDelegateRepresentative {
          delegate_representative: Script(mock_stake_hash),
          deposit: mock_drep_register_deposit,
        },
      )
    |> add_certificate(
        True,
        DelegateCredential {
          credential: Script(mock_stake_hash),
          delegate: DelegateBlockProduction {
            stake_pool: mock_delegate_pool_id,
          },
        },
      )
    |> add_certificate(
        True,
        DelegateCredential {
          credential: Script(mock_stake_hash),
          delegate: DelegateVote {
            delegate_representative: Registered(Script(mock_stake_hash)),
          },
        },
      )
    |> add_proposal_procedure(
        include_proposal,
        ProposalProcedure {
          deposit: mock_gov_deposit,
          return_address: Script(mock_stake_hash),
          governance_action: NicePoll,
        },
      )
}

// Test RegisterCerts - keeps Crowdfund datum (as per validator line 246)
test register_certs_with_crowdfund_output() {
  let input_datum: CrowdfundGovDatum =
    Crowdfund {
      stake_hash: mock_stake_hash,
      share_token: mock_share_token,
      crowdfund_address: mock_crowdfund_address,
      fundraise_target: mock_fundraise_target,
      current_fundraised_amount: mock_funds_controlled,
      allow_over_subscription: False,
      deadline: mock_deadline + mock_gov_action_period,
      expiry_buffer: 3600 * 24,
      min_charge: 10,
    }
  let tx = mock_register_certs_tx_realistic(True)

  gcf_spend_validator.gCf_spend.spend(
    mock_auth_token,
    mock_proposer_key_hash,
    mock_gov_action,
    mock_delegate_pool_id,
    mock_stake_register_deposit,
    mock_drep_register_deposit,
    mock_gov_deposit,
    Some(input_datum),
    RegisterCerts,
    mock_utxo_ref(0, 0),
    tx,
  )
}

// Test RegisterCerts WITHOUT proposal (separated flow)
// This should fail with current validator but helps measure memory
test register_certs_without_proposal() {
  let input_datum: CrowdfundGovDatum =
    Crowdfund {
      stake_hash: mock_stake_hash,
      share_token: mock_share_token,
      crowdfund_address: mock_crowdfund_address,
      fundraise_target: mock_fundraise_target,
      current_fundraised_amount: mock_funds_controlled,
      allow_over_subscription: False,
      deadline: mock_deadline + mock_gov_action_period,
      expiry_buffer: 3600 * 24,
      min_charge: 10,
    }
  let tx = mock_register_certs_tx_realistic(False)

  // This will fail because validator checks for proposal (line 278-284)
  !gcf_spend_validator.gCf_spend.spend(
    mock_auth_token,
    mock_proposer_key_hash,
    mock_gov_action,
    mock_delegate_pool_id,
    mock_stake_register_deposit,
    mock_drep_register_deposit,
    mock_gov_deposit,
    Some(input_datum),
    RegisterCerts,
    mock_utxo_ref(0, 0),
    tx,
  )
}

// Test to measure memory usage for RegisterCerts with proposal
// This test will show memory and CPU costs in the test report
test register_certs_with_proposal_memory_test() {
  let input_datum: CrowdfundGovDatum =
    Crowdfund {
      stake_hash: mock_stake_hash,
      share_token: mock_share_token,
      crowdfund_address: mock_crowdfund_address,
      fundraise_target: mock_fundraise_target,
      current_fundraised_amount: mock_funds_controlled,
      allow_over_subscription: False,
      deadline: mock_deadline + mock_gov_action_period,
      expiry_buffer: 3600 * 24,
      min_charge: 10,
    }
  let tx = mock_register_certs_tx_realistic(True)

  gcf_spend_validator.gCf_spend.spend(
    mock_auth_token,
    mock_proposer_key_hash,
    mock_gov_action,
    mock_delegate_pool_id,
    mock_stake_register_deposit,
    mock_drep_register_deposit,
    mock_gov_deposit,
    Some(input_datum),
    RegisterCerts,
    mock_utxo_ref(0, 0),
    tx,
  )
}

// Test to measure memory usage for RegisterCerts without proposal
// This helps identify if proposal check is causing high memory usage
test register_certs_without_proposal_memory_test() {
  let input_datum: CrowdfundGovDatum =
    Crowdfund {
      stake_hash: mock_stake_hash,
      share_token: mock_share_token,
      crowdfund_address: mock_crowdfund_address,
      fundraise_target: mock_fundraise_target,
      current_fundraised_amount: mock_funds_controlled,
      allow_over_subscription: False,
      deadline: mock_deadline + mock_gov_action_period,
      expiry_buffer: 3600 * 24,
      min_charge: 10,
    }
  let tx = mock_register_certs_tx_realistic(False)

  // This will fail but we can measure memory usage
  !gcf_spend_validator.gCf_spend.spend(
    mock_auth_token,
    mock_proposer_key_hash,
    mock_gov_action,
    mock_delegate_pool_id,
    mock_stake_register_deposit,
    mock_drep_register_deposit,
    mock_gov_deposit,
    Some(input_datum),
    RegisterCerts,
    mock_utxo_ref(0, 0),
    tx,
  )
}

// Test with realistic datum values matching user's input
// Input: {"constructor":0,"fields":["0xdba06cdc58ba2882f0c4106f072504d40240eb11c1c7b2a9a771d307",...]}
// Output: {"constructor":1,"fields":["0xdba06cdc58ba2882f0c4106f072504d40240eb11c1c7b2a9a771d307",...]}
test register_certs_realistic_datum_values() {
  // Using realistic values from user's error report
  let realistic_stake_hash =
    #"dba06cdc58ba2882f0c4106f072504d40240eb11c1c7b2a9a771d307"
  let realistic_share_token =
    #"c1c26c43ae8da6e7ae4f8336a230e496eab14d7e664cd0a0c19d7402"
  let realistic_funds = 100502000000
  let realistic_deadline = 1764201600000

  let input_datum: CrowdfundGovDatum =
    Crowdfund {
      stake_hash: realistic_stake_hash,
      share_token: realistic_share_token,
      crowdfund_address: mock_crowdfund_address,
      fundraise_target: realistic_funds,
      current_fundraised_amount: realistic_funds,
      allow_over_subscription: False,
      deadline: realistic_deadline,
      expiry_buffer: 86400,
      min_charge: 0,
    }

  let input_value =
    from_lovelace(realistic_funds)
      |> add(realistic_stake_hash, "", 1)
      |> add(mock_auth_token, "", 1)

  let deposits =
    mock_stake_register_deposit + mock_drep_register_deposit + mock_gov_deposit
  // Output should only have lovelace + auth token (value_length == 2)
  let output_value =
    from_lovelace(realistic_funds - deposits)
      |> add(mock_auth_token, "", 1)

  // RegisterCerts keeps the same Crowdfund datum
  let output_datum: CrowdfundGovDatum =
    Crowdfund {
      stake_hash: realistic_stake_hash,
      share_token: realistic_share_token,
      crowdfund_address: mock_crowdfund_address,
      fundraise_target: realistic_funds,
      current_fundraised_amount: realistic_funds,
      allow_over_subscription: False,
      deadline: realistic_deadline,
      expiry_buffer: 86400,
      min_charge: 0,
    }

  let tx =
    mocktail_tx()
      |> tx_in(True, mock_tx_hash(0), 0, input_value, mock_gov_address)
      |> tx_in_inline_datum(True, input_datum)
      |> tx_out(True, mock_gov_address, output_value)
      |> tx_out_inline_datum(True, output_datum)
      |> complete()
      |> add_certificate(
          True,
          RegisterCredential {
            credential: Script(realistic_stake_hash),
            deposit: Never,
          },
        )
      |> add_certificate(
          True,
          RegisterDelegateRepresentative {
            delegate_representative: Script(realistic_stake_hash),
            deposit: mock_drep_register_deposit,
          },
        )
      |> add_certificate(
          True,
          DelegateCredential {
            credential: Script(realistic_stake_hash),
            delegate: DelegateBlockProduction {
              stake_pool: mock_delegate_pool_id,
            },
          },
        )
      |> add_certificate(
          True,
          DelegateCredential {
            credential: Script(realistic_stake_hash),
            delegate: DelegateVote {
              delegate_representative: Registered(Script(realistic_stake_hash)),
            },
          },
        )
      |> add_proposal_procedure(
          True,
          ProposalProcedure {
            deposit: mock_gov_deposit,
            return_address: Script(realistic_stake_hash),
            governance_action: NicePoll,
          },
        )

  gcf_spend_validator.gCf_spend.spend(
    mock_auth_token,
    mock_proposer_key_hash,
    mock_gov_action,
    mock_delegate_pool_id,
    mock_stake_register_deposit,
    mock_drep_register_deposit,
    mock_gov_deposit,
    Some(input_datum),
    RegisterCerts,
    mock_utxo_ref(0, 0),
    tx,
  )
}

// Test with realistic values to measure actual memory usage
test register_certs_realistic_memory_test() {
  let realistic_stake_hash =
    #"dba06cdc58ba2882f0c4106f072504d40240eb11c1c7b2a9a771d307"
  let realistic_share_token =
    #"c1c26c43ae8da6e7ae4f8336a230e496eab14d7e664cd0a0c19d7402"
  let realistic_funds = 100502000000
  let realistic_deadline = 1764201600000

  let input_datum: CrowdfundGovDatum =
    Crowdfund {
      stake_hash: realistic_stake_hash,
      share_token: realistic_share_token,
      crowdfund_address: mock_crowdfund_address,
      fundraise_target: realistic_funds,
      current_fundraised_amount: realistic_funds,
      allow_over_subscription: False,
      deadline: realistic_deadline,
      expiry_buffer: 86400,
      min_charge: 0,
    }

  let input_value =
    from_lovelace(realistic_funds)
      |> add(realistic_stake_hash, "", 1)
      |> add(mock_auth_token, "", 1)

  let deposits =
    mock_stake_register_deposit + mock_drep_register_deposit + mock_gov_deposit
  // Output should only have lovelace + auth token (value_length == 2)
  let output_value =
    from_lovelace(realistic_funds - deposits)
      |> add(mock_auth_token, "", 1)

  // RegisterCerts keeps the same Crowdfund datum
  let output_datum: CrowdfundGovDatum =
    Crowdfund {
      stake_hash: realistic_stake_hash,
      share_token: realistic_share_token,
      crowdfund_address: mock_crowdfund_address,
      fundraise_target: realistic_funds,
      current_fundraised_amount: realistic_funds,
      allow_over_subscription: False,
      deadline: realistic_deadline,
      expiry_buffer: 86400,
      min_charge: 0,
    }

  let tx =
    mocktail_tx()
      |> tx_in(True, mock_tx_hash(0), 0, input_value, mock_gov_address)
      |> tx_in_inline_datum(True, input_datum)
      |> tx_out(True, mock_gov_address, output_value)
      |> tx_out_inline_datum(True, output_datum)
      |> complete()
      |> add_certificate(
          True,
          RegisterCredential {
            credential: Script(realistic_stake_hash),
            deposit: Never,
          },
        )
      |> add_certificate(
          True,
          RegisterDelegateRepresentative {
            delegate_representative: Script(realistic_stake_hash),
            deposit: mock_drep_register_deposit,
          },
        )
      |> add_certificate(
          True,
          DelegateCredential {
            credential: Script(realistic_stake_hash),
            delegate: DelegateBlockProduction {
              stake_pool: mock_delegate_pool_id,
            },
          },
        )
      |> add_certificate(
          True,
          DelegateCredential {
            credential: Script(realistic_stake_hash),
            delegate: DelegateVote {
              delegate_representative: Registered(Script(realistic_stake_hash)),
            },
          },
        )
      |> add_proposal_procedure(
          True,
          ProposalProcedure {
            deposit: mock_gov_deposit,
            return_address: Script(realistic_stake_hash),
            governance_action: NicePoll,
          },
        )

  gcf_spend_validator.gCf_spend.spend(
    mock_auth_token,
    mock_proposer_key_hash,
    mock_gov_action,
    mock_delegate_pool_id,
    mock_stake_register_deposit,
    mock_drep_register_deposit,
    mock_gov_deposit,
    Some(input_datum),
    RegisterCerts,
    mock_utxo_ref(0, 0),
    tx,
  )
}
