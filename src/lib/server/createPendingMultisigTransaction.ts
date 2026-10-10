import type { Prisma, PrismaClient, Transaction } from "@prisma/client";
import { getProvider } from "@/utils/get-provider";
import { enqueueSignatureRequiredNotifications } from "@/lib/notifications/center";

export type WalletSubmitShape = {
  numRequiredSigners: number | null;
  type: string;
};

/**
 * Runs inside the same database transaction as the pending row's insert, so a
 * failure here rolls the row back too. Used to link a task-board payout to the
 * transaction it pays (src/lib/task-payout/hooks.ts) — the link and the row
 * exist together or not at all.
 */
export type AfterCreateHook = (
  tx: Prisma.TransactionClient,
  transaction: Transaction,
) => Promise<void>;

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
    /**
     * Who the signature-required notification treats as the creator (and
     * therefore skips). Defaults to the proposer, who has normally signed
     * already. Pass `null` when the proposer has NOT signed — an MCP draft —
     * so they are notified like every other outstanding signer.
     */
    notificationCreatorAddress?: string | null;
    afterCreate?: AfterCreateHook;
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
    notificationCreatorAddress = proposerAddress,
    afterCreate,
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

  const data = {
    walletId,
    txJson: txJsonStr,
    txCbor,
    signedAddresses: initialSignedAddresses,
    rejectedAddresses: [],
    description,
    state: 0,
  };
  const transaction = afterCreate
    ? await db.$transaction(async (tx) => {
        const row = await tx.transaction.create({ data });
        await afterCreate(tx, row);
        return row;
      })
    : await db.transaction.create({ data });

  try {
    const walletRow = await db.wallet.findUnique({
      where: { id: walletId },
      select: {
        id: true,
        name: true,
        signersAddresses: true,
        numRequiredSigners: true,
        type: true,
      },
    });

    if (walletRow) {
      await enqueueSignatureRequiredNotifications(db, {
        wallet: walletRow,
        resourceType: "transaction",
        resourceId: transaction.id,
        signedAddresses: transaction.signedAddresses,
        rejectedAddresses: transaction.rejectedAddresses,
        creatorAddress: notificationCreatorAddress,
        description,
        txJson,
      });
    }
  } catch (error) {
    console.error("Failed to enqueue transaction notifications", error);
  }

  return transaction;
}
