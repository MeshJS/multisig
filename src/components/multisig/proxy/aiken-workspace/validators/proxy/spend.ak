use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{Datum,OutputReference, Transaction}
use cocktail.{only_minted_token, outputs_with_policy}
use types.{ProxyRedeemer, RemoveEmptyInstance, SpendFunds}

validator proxy(auth_token: PolicyId) {
  spend(
    _datum: Option<Datum>,
    redeemer: ProxyRedeemer,
    _input: OutputReference,
    self: Transaction,
  ) {
    let Transaction { mint, outputs, .. } = self

    when redeemer is {
      // check if one auth token is moved in the transaction
      SpendFunds -> {
        // Check if any token from the auth_token policy is present in the outputs
        // This means the token is being moved/transferred signalising that the proxy owners are spending funds
        let auth_tokens_in_outputs = outputs_with_policy(outputs, auth_token)
        // The token is considered "moved" if any auth token appears in outputs
        // (meaning it's being transferred somewhere)
        // This is used to ensure that the proxy owners are spending funds
        // and not someone else
        list.length(auth_tokens_in_outputs) > 0
      }

      RemoveEmptyInstance -> only_minted_token(mint, auth_token, "", -10)?
    }
  }

  else(_) {
    fail
  }
}
