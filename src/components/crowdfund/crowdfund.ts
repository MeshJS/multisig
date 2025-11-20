import {
  ConStr0,
  Integer,
  ByteString,
  MPubKeyAddress,
  Bool,
} from "@meshsdk/common";

export interface CrowdfundDatumTS {
  stake_script: string; // scripthash of the crowdfund stake validator
  share_token: string; // scripthash of the share token
  crowdfund_address: string; // address of the crowdfund
  fundraise_target: number; // Default: 100000000000 lovelace (100000 ADA)
  current_fundraised_amount: number; // Default: 0
  allow_over_subscription: boolean; // Default: false
  deadline: number; // Default: current_time + 30_days
  expiry_buffer: number; // Default: 86400 (1 day in seconds)
  min_charge: number; // Default: 1000000 (1 ADA)
}

export interface GovernanceActionIdTS {
  transaction: string;
  proposal_procedure: number;
}

export interface ProposedDatumTS {
  stake_script: string;
  share_token: string;
  funds_controlled: number;
  deadline: number;
}

export interface VotedDatumTS {
  stake_script: string;
  share_token: string;
  funds_controlled: number;
  gov_tx_id: GovernanceActionIdTS;
  deadline: number;
}

export interface RefundableDatumTS {
  stake_script: string;
  share_token: string;
  funds_controlled: number;
}

export type CrowdfundDatum = ConStr0<
  [
    ByteString, // stake_script
    ByteString, // share_token
    MPubKeyAddress, // crowdfund_address - use MPubKeyAddress, not PubKeyAddress
    Integer, // fundraise_target
    Integer, // current_fundraised_amount
    Bool, // allow_over_subscription
    Integer, // deadline
    Integer, // expiry_buffer
    Integer, // min_charge
  ]
>;
