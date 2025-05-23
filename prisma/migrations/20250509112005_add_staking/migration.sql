-- AlterTable
ALTER TABLE "NewWallet" ADD COLUMN     "numRequiredSigners" INTEGER,
ADD COLUMN     "signersStakeKeys" TEXT[];

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "signersStakeKeys" TEXT[];
