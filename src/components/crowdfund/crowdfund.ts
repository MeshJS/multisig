import { ConStr0, Integer, PubKeyAddress, ByteString } from "@meshsdk/common";

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
    PubKeyAddress, // crowdfund_address
    Integer, // fundraise_target
    Integer, // current_fundraised_amount
    Boolean, // allow_over_subscription
    Integer, // deadline
    Integer, // expiry_buffer
    PubKeyAddress, // fee_address
    Integer, // min_charge
  ]
>;
