-- DropIndex
DROP INDEX "BalanceSnapshot_snapshotDate_idx";

-- DropIndex
DROP INDEX "BalanceSnapshot_walletId_idx";

-- AlterTable
ALTER TABLE "NewWallet" ADD COLUMN     "paymentCbor" TEXT,

