use cardano/address.{Address}
use cardano/governance.{GovernanceActionId}

pub type CrowdfundGovRedeemer {
  ContributeFund
  PreMatureContributorWithdrawal
  PreMatureRemoveEmptyInstance
  RegisterCerts
  ProposeGovAction 
  // {
  //   gov_action_type: Int,
  //   // 0: ProtocolParameters, 1: HardFork,  2: TreasuryWithdrawal, 3: NoConfidence, 4: ConstitutionalCommittee, 5: NewConstitution, 6: NicePoll (InfoAction)
  // }
  VoteOnGovAction
  DeregisterCerts
  AfterCompleteContributorWithdrawal
  AfterCompleteRemoveEmptyInstance
}

pub type CrowdfundGovDatum {
  Crowdfund {
    stake_hash: ByteArray,
    share_token: ByteArray,
    crowdfund_address: Address,
    fundraise_target: Int,
    current_fundraised_amount: Int,
    allow_over_subscription: Bool,
    deadline: Int,
    expiry_buffer: Int,
    min_charge: Int,
  }
  Proposed {
    stake_hash: ByteArray,
    share_token: ByteArray,
    funds_controlled: Int,
    deadline: Int,
  }
  Voted {
    stake_hash: ByteArray,
    share_token: ByteArray,
    funds_controlled: Int,
    gov_tx_id: GovernanceActionId,
    deadline: Int,
  }
  Refundable {
    stake_hash: ByteArray,
    share_token: ByteArray,
    funds_controlled: Int,
  }
}

pub type MintPolarity {
  RMint
  RBurn
}

pub type PublishRedeemer {
  Register
  Deregister
}
