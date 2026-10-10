-- AlterTable
ALTER TABLE "PendingBot" ALTER COLUMN "paymentAddress" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PendingBot" ADD COLUMN "botKeyId" TEXT;
