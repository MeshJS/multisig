import { NativeScript } from "@meshsdk/core";
import { Wallet as DbWallet } from "@prisma/client";

export type Wallet = DbWallet & {
  nativeScript: NativeScript;
  address: string;
  dRepId: string;
};

