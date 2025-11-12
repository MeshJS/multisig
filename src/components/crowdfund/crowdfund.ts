import { ConStr0, Integer, ByteString, MPubKeyAddress, Bool } from "@meshsdk/common";

export interface CrowdfundDatumTS {
  completion_script: string; // scripthash of the gov_crowdfund
  share_token: string; // scripthash of the share token
  crowdfund_address: string; // address of the crowdfund
  fundraise_target: number; // Default: 100000000000 lovelace (100000 ADA)
  current_fundraised_amount: number; // Default: 0
  allow_over_subscription: boolean; // Default: false
  deadline: number; // Default: current_time + 30_days
  expiry_buffer: number; // Default: 86400 (1 day in seconds)
  fee_address: string; // Default: proposer address
  min_charge: number; // Default: 1000000 (1 ADA)
}

export type CrowdfundDatum = ConStr0<
  [
    ByteString, // completion_script
    ByteString, // share_token
    MPubKeyAddress, // crowdfund_address - use MPubKeyAddress, not PubKeyAddress
    Integer, // fundraise_target
    Integer, // current_fundraised_amount
    Bool, // allow_over_subscription
    Integer, // deadline
    Integer, // expiry_buffer
    MPubKeyAddress, // fee_address - use MPubKeyAddress, not PubKeyAddress
    Integer, // min_charge
  ]
>;
