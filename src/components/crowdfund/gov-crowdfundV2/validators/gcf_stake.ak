use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use types.{
  Deregister, DeregisterCerts, ProposeGovAction, PublishRedeemer, Register,
  RegisterCerts, VoteOnGovAction,
}
use utils.{check_auth_token_input_redeemer}

// Stake validator coordinating governance operations and token lifecycle
validator gCf_stake(auth_token: PolicyId) {
  // Publish: Validate certificate registration/deregistration coordination
  publish(redeemer: PublishRedeemer, _c, self: Transaction) {
    let Transaction { inputs, redeemers, .. } = self

    when redeemer is {
      // Register: Validate spend validator is registering certificates
      Register ->
        check_auth_token_input_redeemer(
          auth_token,
          inputs,
          redeemers,
          RegisterCerts,
        )?
      // Deregister: Validate spend validator is deregistering certificates
      Deregister ->
        check_auth_token_input_redeemer(
          auth_token,
          inputs,
          redeemers,
          DeregisterCerts,
        )?
    }
  }

  // Propose: Validate governance proposal submission coordination
  propose(_r, _p, self: Transaction) {
    let Transaction { inputs, redeemers, .. } = self
    check_auth_token_input_redeemer(
      auth_token,
      inputs,
      redeemers,
      ProposeGovAction,
    )?
  }

  // Vote: Validate governance vote coordination
  vote(_r, _v, self: Transaction) {
    let Transaction { inputs, redeemers, .. } = self
    check_auth_token_input_redeemer(
      auth_token,
      inputs,
      redeemers,
      VoteOnGovAction,
    )?
  }

  else(_) {
    fail
  }
}
