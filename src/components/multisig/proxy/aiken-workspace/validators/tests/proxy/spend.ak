use cardano/assets.{add, from_lovelace}
use mocktail.{
  complete, mint, mock_policy_id, mock_pub_key_address, mock_utxo_ref,
  mocktail_tx, tx_out,
}
use proxy/spend as proxy_spend
use types.{RemoveEmptyInstance, SpendFunds}

const auth_token = mock_policy_id(0)

// SpendFunds: succeeds when any token of auth_token policy appears in outputs
test p_proxy_spend_success_spend_funds_when_auth_token_in_outputs() {
  let value = from_lovelace(2_000_000) |> add(auth_token, "", 1)
  let tx =
    mocktail_tx()
      |> tx_out(True, mock_pub_key_address(0, None), value)
      |> complete()

  proxy_spend.proxy.spend(auth_token, None, SpendFunds, mock_utxo_ref(0, 0), tx)
}

// SpendFunds: fails when no auth_token policy appears in outputs
test p_proxy_spend_fail_spend_funds_when_no_auth_token_in_outputs() {
  let value = from_lovelace(2_000_000)
  let tx =
    mocktail_tx()
      |> tx_out(True, mock_pub_key_address(1, None), value)
      |> complete()

  !proxy_spend.proxy.spend(
    auth_token,
    None,
    SpendFunds,
    mock_utxo_ref(0, 0),
    tx,
  )
}

// RemoveEmptyInstance: succeeds when exact burn of -10 under auth_token policy
test p_proxy_spend_success_remove_empty_instance_with_auth_burnt() {
  let tx =
    mocktail_tx()
      |> mint(True, -10, auth_token, "")
      |> complete()

  proxy_spend.proxy.spend(
    auth_token,
    None,
    RemoveEmptyInstance,
    mock_utxo_ref(0, 0),
    tx,
  )
}

// RemoveEmptyInstance: fails when no burn occurs
test p_proxy_spend_fail_remove_empty_instance_without_burn() {
  let tx = mocktail_tx() |> complete()
  !proxy_spend.proxy.spend(
    auth_token,
    None,
    RemoveEmptyInstance,
    mock_utxo_ref(0, 0),
    tx,
  )
}
