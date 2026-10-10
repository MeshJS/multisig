import type { UTxO } from "@meshsdk/core";

export const SCRIPT_ADDRESS = "addr_test1wqag3rt979nep9g065n4qdfn8475ztnsarek70g8cxu4wlgj6veh3";
export const CHANGE_ADDRESS = "addr_test1qpbotintegrationfixture000000000000000000000000";
export const REWARD_ADDRESS = "stake_test1uzqrj44szyh7hg9e7xvxcd58f3vl9kekk6cxn9l5jt0x00cxm2dq4";
export const POOL_HEX = "pool1pu5jlj4q9w9jlxeu370a3c9myx47md5j5m2str0naunn2q3lkdy";

export const PARAM_UTXO = {
  txHash: "a".repeat(64),
  outputIndex: 0,
} as const;

export const STAKING_SCRIPT_CBOR = "5901" + "00".repeat(200);
export const DREP_SCRIPT_CBOR    = "5901" + "01".repeat(200);

function mkUtxo(
  txHash: string,
  outputIndex: number,
  address: string,
  lovelace: string,
  token?: { unit: string; quantity: string },
): UTxO {
  return {
    input: { txHash, outputIndex },
    output: {
      address,
      amount: token
        ? [{ unit: "lovelace", quantity: lovelace }, token]
        : [{ unit: "lovelace", quantity: lovelace }],
    },
  };
}

export const FIXTURE_UTXO_LOVELACE: UTxO = mkUtxo(
  "b".repeat(64), 0, SCRIPT_ADDRESS, "10000000",
);

export const FIXTURE_UTXO_TOKEN: UTxO = mkUtxo(
  "c".repeat(64), 0, SCRIPT_ADDRESS, "2000000",
  { unit: "d".repeat(56) + "6d79546f6b656e", quantity: "1" },
);

export const FIXTURE_COLLATERAL: UTxO = mkUtxo(
  "e".repeat(64), 0, CHANGE_ADDRESS, "5000000",
);

export const FIXTURE_UTXOS: UTxO[] = [FIXTURE_UTXO_LOVELACE, FIXTURE_UTXO_TOKEN];
