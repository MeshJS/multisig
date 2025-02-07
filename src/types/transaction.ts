export type UTXO = {
  address: string;
  amount: { unit: string; quantity: string }[];
  output_index: number;
};

export type TxInfo = {
  block_height: number;
  block_time: number;
  tx_hash: string;
  tx_index: number;
};

export type OnChainTransaction = {
  hash: string;
  tx: TxInfo;
  inputs: UTXO[];
  outputs: UTXO[];
};
