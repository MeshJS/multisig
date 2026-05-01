import type { PrismaClient } from "@prisma/client";
import { getProvider } from "@/utils/get-provider";

export type WalletSubmitShape = {
  numRequiredSigners: number | null;
  type: string;
};

function getRequiredSignerCount(wallet: WalletSubmitShape): number {
  if (wallet.type === "any") return 1;
  if (wallet.type === "atLeast" || typeof wallet.numRequiredSigners === "number") {
    return wallet.numRequiredSigners ?? 1;
  }
  return Number.POSITIVE_INFINITY;
}

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
    initialSignedAddresses?: string[];
  },
) {
  const {
    walletId,
    wallet,
    proposerAddress,
    txCbor,
    txJson,
    description,
    network,
    initialSignedAddresses = [proposerAddress],
  } = args;
  const reqSigners = wallet.numRequiredSigners;
  const wtype = wallet.type;

  const txJsonStr =
    typeof txJson === "object" && txJson !== null
      ? JSON.stringify(txJson)
      : String(txJson);

  const requiredSigners = getRequiredSignerCount(wallet);
  if ((reqSigners === 1 || wtype === "any") && initialSignedAddresses.length >= requiredSigners) {
    const blockchainProvider = getProvider(network);
    return await blockchainProvider.submitTx(txCbor);
  }

  return await db.transaction.create({
    data: {
      walletId,
      txJson: txJsonStr,
      txCbor,
      signedAddresses: initialSignedAddresses,
      rejectedAddresses: [],
      description,
      state: 0,
    },
  });
}
