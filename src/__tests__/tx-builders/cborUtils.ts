import { decode } from "cbor-x";

export const TX_BODY_KEYS = {
  INPUTS:      0,
  OUTPUTS:     1,
  FEE:         2,
  CERTS:       4,
  WITHDRAWALS: 5,
  MINT:        9,
  VOTES:       19,
} as const;

export const CERT_KIND = {
  STAKE_REGISTRATION:    0,
  STAKE_DEREGISTRATION:  1,
  STAKE_DELEGATION:      2,
  DREP_REGISTRATION:    16,
  DREP_DEREGISTRATION:  17,
  DREP_UPDATE:          18,
} as const;

export function decodeTxBody(cbor: string): Map<number, unknown> {
  const [body] = decode(Buffer.from(cbor, "hex")) as [Map<number, unknown>];
  return body;
}

export function getCerts(body: Map<number, unknown>): unknown[][] {
  return (body.get(TX_BODY_KEYS.CERTS) as unknown[][] | undefined) ?? [];
}

export function getWithdrawals(body: Map<number, unknown>): Map<Uint8Array, bigint> {
  return (body.get(TX_BODY_KEYS.WITHDRAWALS) as Map<Uint8Array, bigint> | undefined) ?? new Map();
}
