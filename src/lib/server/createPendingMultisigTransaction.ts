import type { PrismaClient } from "@prisma/client";
import { getProvider } from "@/utils/get-provider";

export type WalletSubmitShape = {
  numRequiredSigners: number | null;
  type: string;
};

/**
 * Same broadcast vs pending rules as addTransaction: single signer or "any" → submit; else persist pending.
 */
export async function createPendingMultisigTransaction(
  db: PrismaClient,
  args: {
    walletId: string;
    wallet: WalletSubmitShape;
    proposerAddress: string;
    txCbor: string;
    txJson: unknown;
    description: string;
    network: number;
  },
) {
  const { walletId, wallet, proposerAddress, txCbor, txJson, description, network } =
    args;
  const reqSigners = wallet.numRequiredSigners;
  const wtype = wallet.type;

  const txJsonStr =
    typeof txJson === "object" && txJson !== null
      ? JSON.stringify(txJson)
      : String(txJson);

  if (reqSigners === 1 || wtype === "any") {
    const blockchainProvider = getProvider(network);
    return await blockchainProvider.submitTx(txCbor);
  }

  return await db.transaction.create({
    data: {
      walletId,
      txJson: txJsonStr,
      txCbor,
      signedAddresses: [proposerAddress],
      rejectedAddresses: [],
      description,
      state: 0,
    },
  });
}
