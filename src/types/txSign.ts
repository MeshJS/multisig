import type { NativeScript } from "@meshsdk/core";
import type { Wallet } from "@/types/wallet";

export type TxSubmitter = {
  submitTx: (txHex: string) => Promise<string>;
};

export type ScriptRecoveryWallet = Pick<
  Wallet,
  "type" | "numRequiredSigners" | "signersAddresses" | "scriptCbor"
> & {
  rawImportBodies?: unknown;
  nativeScript?: NativeScript;
  address?: string;
};

export type SubmitTxWithRecoveryArgs = {
  txHex: string;
  submitter: TxSubmitter;
  appWallet?: ScriptRecoveryWallet;
  network?: number;
};

export type SubmitTxWithRecoveryResult = {
  txHash: string;
  txHex: string;
  repaired: boolean;
};

export type MultisigSubmissionWallet = Pick<
  ScriptRecoveryWallet,
  "type" | "numRequiredSigners" | "signersAddresses"
>;