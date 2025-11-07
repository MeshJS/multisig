import { NativeScript } from "@meshsdk/core";
import { Wallet as DbWallet } from "@prisma/client";

export interface RawImportBodiesUser {
  ada_handle?: string;
  address_bech32?: string;
  id?: string;
  name?: string;
  profile_photo_url?: string;
  stake_pubkey_hash_hex?: string;
  [key: string]: unknown;
}

export interface RawImportBodiesCommunity {
  description?: string;
  id?: string;
  name?: string;
  profile_photo_url?: string;
  verified?: boolean;
  verified_name?: string;
  [key: string]: unknown;
}

export interface RawImportBodiesMultisig {
  address?: string;
  created_at?: string;
  id?: string;
  name?: string;
  payment_script?: string;
  stake_script?: string;
  [key: string]: unknown;
}

export interface RawImportBodies {
  community?: RawImportBodiesCommunity;
  multisig?: RawImportBodiesMultisig;
  timestamp?: string;
  users?: RawImportBodiesUser[];
  [key: string]: unknown;
}

export type DbWalletWithLegacy = DbWallet & {
  rawImportBodies?: RawImportBodies | null;
};

export type Wallet = DbWalletWithLegacy & {
  nativeScript: NativeScript;
  address: string;
  dRepId: string;
  stakeScriptCbor?: string;
};

