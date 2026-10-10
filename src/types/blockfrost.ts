/**
 * Wider Blockfrost response types for transaction endpoints. The narrow
 * `UTXO` in `@/types/transaction` (used by the zustand tx store) drops
 * fields the token-flow adapters need — notably the `collateral`/`reference`
 * flags on inputs, which must be excluded from value flows or balance math
 * breaks on script transactions. Existing consumers keep the narrow type.
 */
import type { UTXO } from "@/types/transaction";

export type BlockfrostTxInput = UTXO & {
  tx_hash: string;
  collateral: boolean;
  reference: boolean;
  data_hash: string | null;
};

export type BlockfrostTxOutput = UTXO & {
  data_hash: string | null;
  /** Collateral return output; only consumed when the script fails. */
  collateral?: boolean;
};

export type BlockfrostTxUtxos = {
  hash: string;
  inputs: BlockfrostTxInput[];
  outputs: BlockfrostTxOutput[];
};

/** GET /txs/{hash} — the fields the token-flow feature reads. */
export type BlockfrostTxInfo = {
  hash: string;
  block_height: number;
  block_time: number;
  fees: string; // lovelace; Blockfrost uses the plural key
  deposit: string; // net deposit in lovelace; negative = refund
  valid_contract: boolean;
  withdrawal_count: number;
  delegation_count: number;
  stake_cert_count: number;
  pool_update_count: number;
  pool_retire_count: number;
  asset_mint_or_burn_count: number;
  redeemer_count: number;
};

/** GET /txs/{hash}/withdrawals */
export type BlockfrostTxWithdrawal = {
  address: string; // stake address
  amount: string; // lovelace
};

/** GET /txs/{hash}/delegations */
export type BlockfrostTxDelegation = {
  index: number;
  cert_index: number;
  address: string; // stake address
  pool_id: string;
};

/** GET /txs/{hash}/stakes */
export type BlockfrostTxStakeCert = {
  cert_index: number;
  address: string; // stake address
  registration: boolean;
};

/** GET /governance/dreps/{drep_id}/updates */
export type BlockfrostDrepUpdate = {
  tx_hash: string;
  cert_index: number;
  action: "registered" | "updated" | "deregistered";
};

/** Everything the token-flow visualization needs for one on-chain tx. */
export type TxFlowData = {
  info: BlockfrostTxInfo;
  utxos: BlockfrostTxUtxos;
  withdrawals?: BlockfrostTxWithdrawal[];
  delegations?: BlockfrostTxDelegation[];
  stakes?: BlockfrostTxStakeCert[];
  poolUpdates?: unknown[];
};
