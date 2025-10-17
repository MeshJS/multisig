-- AlterTable
ALTER TABLE "NewWallet" ADD COLUMN     "stakeCbor" TEXT,
ADD COLUMN     "usesStored" BOOLEAN NOT NULL DEFAULT false;
