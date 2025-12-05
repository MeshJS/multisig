use cardano/address.{Address, Script}
use cardano/assets.{add, from_lovelace}
use cardano/certificate.{
  DelegateBlockProduction, DelegateCredential, DelegateVote, RegisterCredential,
  RegisterDelegateRepresentative, Registered,
}
use cardano/transaction.{Transaction}
use mocktail.{
  add_certificate, complete, mock_pub_key_address,
  mock_tx_hash, mocktail_tx, MocktailTx, tx_in,
  tx_in_inline_datum, tx_out, tx_out_inline_datum,
}
use tests/test_utils.{
  mock_auth_token, mock_deadline, mock_delegate_pool_id,
  mock_fundraise_target, mock_gov_address, mock_share_token, mock_stake_hash,
}
use types.{Crowdfund, CrowdfundGovDatum, Proposed}

// Helper to add multiple wallet inputs (simplified to avoid compilation issues)
// For now, limit to manual chaining for small numbers
fn add_wallet_inputs(tx: MocktailTx, count: Int) -> MocktailTx {
  // Simplified: only handle up to 5 inputs to avoid compilation issues
  if count <= 0 {
    tx
  } else if count == 1 {
    let wallet_value = from_lovelace(10_000_000)
    tx |> tx_in(True, mock_tx_hash(100), 0, wallet_value, mock_pub_key_address(0, None))
  } else if count == 2 {
    let tx1 = tx |> tx_in(True, mock_tx_hash(100), 0, from_lovelace(10_000_000), mock_pub_key_address(0, None))
    tx1 |> tx_in(True, mock_tx_hash(101), 1, from_lovelace(15_000_000), mock_pub_key_address(1, None))
  } else if count == 3 {
    let tx1 = tx |> tx_in(True, mock_tx_hash(100), 0, from_lovelace(10_000_000), mock_pub_key_address(0, None))
    let tx2 = tx1 |> tx_in(True, mock_tx_hash(101), 1, from_lovelace(15_000_000), mock_pub_key_address(1, None))
    tx2 |> tx_in(True, mock_tx_hash(102), 2, from_lovelace(20_000_000), mock_pub_key_address(2, None))
  } else if count == 4 {
    let tx1 = tx |> tx_in(True, mock_tx_hash(100), 0, from_lovelace(10_000_000), mock_pub_key_address(0, None))
    let tx2 = tx1 |> tx_in(True, mock_tx_hash(101), 1, from_lovelace(15_000_000), mock_pub_key_address(1, None))
    let tx3 = tx2 |> tx_in(True, mock_tx_hash(102), 2, from_lovelace(20_000_000), mock_pub_key_address(2, None))
    tx3 |> tx_in(True, mock_tx_hash(103), 3, from_lovelace(25_000_000), mock_pub_key_address(3, None))
  } else if count == 5 {
    let tx1 = tx |> tx_in(True, mock_tx_hash(100), 0, from_lovelace(10_000_000), mock_pub_key_address(0, None))
    let tx2 = tx1 |> tx_in(True, mock_tx_hash(101), 1, from_lovelace(15_000_000), mock_pub_key_address(1, None))
    let tx3 = tx2 |> tx_in(True, mock_tx_hash(102), 2, from_lovelace(20_000_000), mock_pub_key_address(2, None))
    let tx4 = tx3 |> tx_in(True, mock_tx_hash(103), 3, from_lovelace(25_000_000), mock_pub_key_address(3, None))
    tx4 |> tx_in(True, mock_tx_hash(104), 4, from_lovelace(30_000_000), mock_pub_key_address(4, None))
  } else {
    // For counts > 5, just add 5 inputs
    let tx1 = tx |> tx_in(True, mock_tx_hash(100), 0, from_lovelace(10_000_000), mock_pub_key_address(0, None))
    let tx2 = tx1 |> tx_in(True, mock_tx_hash(101), 1, from_lovelace(15_000_000), mock_pub_key_address(1, None))
    let tx3 = tx2 |> tx_in(True, mock_tx_hash(102), 2, from_lovelace(20_000_000), mock_pub_key_address(2, None))
    let tx4 = tx3 |> tx_in(True, mock_tx_hash(103), 3, from_lovelace(25_000_000), mock_pub_key_address(3, None))
    tx4 |> tx_in(True, mock_tx_hash(104), 4, from_lovelace(30_000_000), mock_pub_key_address(4, None))
  }
}

// Helper to add multiple change outputs (simplified)
fn add_change_outputs(tx: MocktailTx, count: Int) -> MocktailTx {
  // Simplified: only handle up to 5 outputs
  if count <= 0 {
    tx
  } else if count == 1 {
    tx |> tx_out(True, mock_pub_key_address(1000, None), from_lovelace(5_000_000))
  } else if count == 2 {
    let tx1 = tx |> tx_out(True, mock_pub_key_address(1000, None), from_lovelace(5_000_000))
    tx1 |> tx_out(True, mock_pub_key_address(1001, None), from_lovelace(7_000_000))
  } else if count == 3 {
    let tx1 = tx |> tx_out(True, mock_pub_key_address(1000, None), from_lovelace(5_000_000))
    let tx2 = tx1 |> tx_out(True, mock_pub_key_address(1001, None), from_lovelace(7_000_000))
    tx2 |> tx_out(True, mock_pub_key_address(1002, None), from_lovelace(9_000_000))
  } else if count == 4 {
    let tx1 = tx |> tx_out(True, mock_pub_key_address(1000, None), from_lovelace(5_000_000))
    let tx2 = tx1 |> tx_out(True, mock_pub_key_address(1001, None), from_lovelace(7_000_000))
    let tx3 = tx2 |> tx_out(True, mock_pub_key_address(1002, None), from_lovelace(9_000_000))
    tx3 |> tx_out(True, mock_pub_key_address(1003, None), from_lovelace(11_000_000))
  } else if count == 5 {
    let tx1 = tx |> tx_out(True, mock_pub_key_address(1000, None), from_lovelace(5_000_000))
    let tx2 = tx1 |> tx_out(True, mock_pub_key_address(1001, None), from_lovelace(7_000_000))
    let tx3 = tx2 |> tx_out(True, mock_pub_key_address(1002, None), from_lovelace(9_000_000))
    let tx4 = tx3 |> tx_out(True, mock_pub_key_address(1003, None), from_lovelace(11_000_000))
    tx4 |> tx_out(True, mock_pub_key_address(1004, None), from_lovelace(13_000_000))
  } else {
    // For counts > 5, just add 5 outputs
    let tx1 = tx |> tx_out(True, mock_pub_key_address(1000, None), from_lovelace(5_000_000))
    let tx2 = tx1 |> tx_out(True, mock_pub_key_address(1001, None), from_lovelace(7_000_000))
    let tx3 = tx2 |> tx_out(True, mock_pub_key_address(1002, None), from_lovelace(9_000_000))
    let tx4 = tx3 |> tx_out(True, mock_pub_key_address(1003, None), from_lovelace(11_000_000))
    tx4 |> tx_out(True, mock_pub_key_address(1004, None), from_lovelace(13_000_000))
  }
}

// Realistic transaction configuration
pub type RealisticTxConfig {
  RealisticTxConfig {
    num_wallet_inputs: Int,
    num_change_outputs: Int,
    include_collateral: Bool,
    include_reference_inputs: Bool,
  }
}

// Helper to create realistic wallet input (simulating real UTxO)
// Note: This function is not currently used but kept for potential future use
pub fn create_wallet_input(
  tx_hash_index: Int,
  output_index: Int,
  lovelace_amount: Int,
  address: Address,
) -> MocktailTx {
  let wallet_value = from_lovelace(lovelace_amount)
  mocktail_tx()
    |> tx_in(
        True,
        mock_tx_hash(tx_hash_index),
        output_index,
        wallet_value,
        address,
      )
}


// Build realistic RegisterStake transaction with multiple inputs/outputs
pub fn build_realistic_register_stake_tx(
  config: RealisticTxConfig,
  input_datum: CrowdfundGovDatum,
  funds_controlled: Int,
  stake_register_deposit: Int,
) -> Transaction {
  let RealisticTxConfig {
    num_wallet_inputs,
    num_change_outputs,
    include_collateral,
    ..
  } = config

  // Auth token input/output value
  let auth_input_value =
    from_lovelace(funds_controlled)
      |> add(mock_stake_hash, "", 1)
      |> add(mock_auth_token, "", 1)

  let auth_output_value =
    from_lovelace(funds_controlled - stake_register_deposit)
      |> add(mock_stake_hash, "", 1)
      |> add(mock_auth_token, "", 1)

  let output_datum: CrowdfundGovDatum =
    when input_datum is {
      Crowdfund { stake_hash, share_token, deadline, .. } ->
        Proposed {
          stake_hash,
          share_token,
          funds_controlled,
          deadline,
        }
      _ -> Proposed {
        stake_hash: mock_stake_hash,
        share_token: mock_share_token,
        funds_controlled,
        deadline: mock_deadline,
      }
    }

  // Start with auth token input/output
  let tx =
    mocktail_tx()
      |> tx_in(True, mock_tx_hash(0), 0, auth_input_value, mock_gov_address)
      |> tx_in_inline_datum(True, input_datum)
      |> tx_out(True, mock_gov_address, auth_output_value)
      |> tx_out_inline_datum(True, output_datum)

  // Add wallet inputs (simulating real UTxO selection)
  // These are inputs that don't match the auth token, simulating wallet UTxOs
  // Using direct chaining instead of foldl to avoid compilation issues
  let tx = add_wallet_inputs(tx, num_wallet_inputs)

  // Add change outputs (simulating wallet change)
  let tx = add_change_outputs(tx, num_change_outputs)

  // Add collateral if needed (must be before complete())
  let tx =
    if include_collateral {
      let collateral_value = from_lovelace(5_000_000)
      tx
        |> tx_in(
            True,
            mock_tx_hash(999),
            0,
            collateral_value,
            mock_pub_key_address(999, None),
          )
    } else {
      tx
    }

  // Complete transaction (converts MocktailTx to Transaction)
  let tx = tx |> complete()

  // Add certificates (works on Transaction)
  tx
    |> add_certificate(
        True,
        RegisterCredential {
          credential: Script(mock_stake_hash),
          deposit: Never,
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
}

// Build realistic RegisterDrep transaction
pub fn build_realistic_register_drep_tx(
  config: RealisticTxConfig,
  input_datum: CrowdfundGovDatum,
  funds_controlled: Int,
  drep_register_deposit: Int,
) -> Transaction {
  let RealisticTxConfig {
    num_wallet_inputs,
    num_change_outputs,
    include_collateral,
    ..
  } = config

  // Auth token input/output value
  let auth_input_value =
    from_lovelace(funds_controlled)
      |> add(mock_stake_hash, "", 1)
      |> add(mock_auth_token, "", 1)

  let auth_output_value =
    from_lovelace(funds_controlled - drep_register_deposit)
      |> add(mock_stake_hash, "", 1)
      |> add(mock_auth_token, "", 1)

  let output_datum: CrowdfundGovDatum =
    when input_datum is {
      Proposed { stake_hash, share_token, deadline, .. } ->
        Proposed {
          stake_hash,
          share_token,
          funds_controlled,
          deadline,
        }
      _ -> Proposed {
        stake_hash: mock_stake_hash,
        share_token: mock_share_token,
        funds_controlled,
        deadline: mock_deadline,
      }
    }

  // Start with auth token input/output
  let tx =
    mocktail_tx()
      |> tx_in(True, mock_tx_hash(0), 0, auth_input_value, mock_gov_address)
      |> tx_in_inline_datum(True, input_datum)
      |> tx_out(True, mock_gov_address, auth_output_value)
      |> tx_out_inline_datum(True, output_datum)

  // Add wallet inputs
  let tx = add_wallet_inputs(tx, num_wallet_inputs)

  // Add change outputs
  let tx = add_change_outputs(tx, num_change_outputs)

  // Add collateral if needed (must be before complete())
  let tx =
    if include_collateral {
      let collateral_value = from_lovelace(5_000_000)
      tx
        |> tx_in(
            True,
            mock_tx_hash(999),
            0,
            collateral_value,
            mock_pub_key_address(999, None),
          )
    } else {
      tx
    }

  // Complete transaction (converts MocktailTx to Transaction)
  let tx = tx |> complete()

  // Add DRep certificates (works on Transaction)
  tx
    |> add_certificate(
        True,
        RegisterDelegateRepresentative {
          delegate_representative: Script(mock_stake_hash),
          deposit: drep_register_deposit,
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
}

// Create realistic crowdfund datum matching real-world values
pub fn create_realistic_crowdfund_datum(
  current_fundraised_amount: Int,
) -> CrowdfundGovDatum {
  Crowdfund {
    stake_hash: mock_stake_hash,
    share_token: mock_share_token,
    crowdfund_address: mock_gov_address,
    fundraise_target: mock_fundraise_target,
    current_fundraised_amount,
    allow_over_subscription: False,
    deadline: mock_deadline,
    expiry_buffer: 86400,
    min_charge: 0,
  }
}

// Create realistic proposed datum
pub fn create_realistic_proposed_datum(
  funds_controlled: Int,
) -> CrowdfundGovDatum {
  Proposed {
    stake_hash: mock_stake_hash,
    share_token: mock_share_token,
    funds_controlled,
    deadline: mock_deadline,
  }
}

