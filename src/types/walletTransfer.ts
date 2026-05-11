export const WALLET_TRANSFER_FORMAT = "multisig-wallet-transfer" as const;
export const WALLET_TRANSFER_VERSION = 1 as const;

export type WalletTransferType = "atLeast" | "all" | "any";

export type WalletTransferDefinition = {
  name: string;
  description: string;
  type: WalletTransferType;
  signersAddresses: string[];
  signersStakeKeys: string[];
  signersDRepKeys: string[];
  signersDescriptions: string[];
  numRequiredSigners: number | null;
  scriptCbor: string;
  stakeCredentialHash: string | null;
  profileImageIpfsUrl?: string | null;
};

export type WalletTransferContact = {
  name: string;
  address: string;
  description?: string | null;
};

export type WalletTransferBallot = {
  description?: string | null;
  items: string[];
  itemDescriptions: string[];
  choices: string[];
  anchorUrls: string[];
  anchorHashes: string[];
  rationaleComments: string[];
  type: number;
};

export type WalletTransferPayloadV1 = {
  format: typeof WALLET_TRANSFER_FORMAT;
  version: typeof WALLET_TRANSFER_VERSION;
  exportedAt: string;
  exportedFromOrigin: string;
  exporterAddress: string;
  wallet: WalletTransferDefinition;
  contacts?: WalletTransferContact[];
  ballots?: WalletTransferBallot[];
};
