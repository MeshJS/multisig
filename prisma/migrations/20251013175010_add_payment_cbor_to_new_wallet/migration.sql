/*
  Warnings:

  - Added the required column `paymentCbor` to the `NewWallet` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "BalanceSnapshot_snapshotDate_idx";

-- DropIndex
DROP INDEX "BalanceSnapshot_walletId_idx";

-- AlterTable
ALTER TABLE "NewWallet" ADD COLUMN     "paymentCbor" TEXT NOT NULL,