use aiken/collection/pairs.{has_key}
use cardano/address.{Credential, Script}
use cardano/assets.{PolicyId, lovelace_of}
use cardano/transaction.{OutputReference, Transaction, find_input}
use cocktail.{
  inputs_at_with_policy, key_signed, only_minted_token, output_inline_datum,
  outputs_at_with_policy, policy_only_minted_token, valid_after, valid_before,
  value_length,
}
use types.{
  CompleteCrowdfund, ContributeFund, ContributorWithdrawal, CrowdfundDatum,
  CrowdfundRedeemer, RemoveEmptyInstance,
}
use utils.{check_fundraise_target, outputs_at_with_lovelace}

validator proxy(auth_token: PolicyId) {
  spend(
    redeemer: CrowdfundRedeemer,
    input: OutputReference,
    self: Transaction,
  ) {
    let Transaction {
      inputs,
      validity_range,
      mint,
      outputs,
      withdrawals,
      extra_signatories,
      ..
    } = self

    when redeemer is {

      
      

      RemoveEmptyInstance -> {

        let token_burnt_check = only_minted_token(mint, auth_token, completion_script, -10)?
      }
    }
  }

  else(_) {
    fail
  }
}
