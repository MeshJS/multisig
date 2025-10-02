-- AlterTable
ALTER TABLE "User" ADD COLUMN     "drepKeyHash" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "signersDRepKeys" TEXT[];
