-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "ownerAddress" TEXT;

-- CreateTable
CREATE TABLE "BotKey" (
    "id" TEXT NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotUser" (
    "id" TEXT NOT NULL,
    "botKeyId" TEXT NOT NULL,
    "paymentAddress" TEXT NOT NULL,
    "stakeAddress" TEXT,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotUser_pkey" PRIMARY KEY ("id")
);

-- CreateEnum
CREATE TYPE "BotWalletRole" AS ENUM ('cosigner', 'observer');

-- CreateTable
CREATE TABLE "WalletBotAccess" (
    "walletId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "role" "BotWalletRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletBotAccess_pkey" PRIMARY KEY ("walletId","botId")
);

-- CreateIndex
CREATE INDEX "BotKey_ownerAddress_idx" ON "BotKey"("ownerAddress");

-- CreateIndex
CREATE UNIQUE INDEX "BotUser_botKeyId_key" ON "BotUser"("botKeyId");

-- CreateIndex
CREATE UNIQUE INDEX "BotUser_paymentAddress_key" ON "BotUser"("paymentAddress");

-- CreateIndex
CREATE INDEX "BotUser_paymentAddress_idx" ON "BotUser"("paymentAddress");

-- CreateIndex
CREATE INDEX "WalletBotAccess_walletId_idx" ON "WalletBotAccess"("walletId");

-- CreateIndex
CREATE INDEX "WalletBotAccess_botId_idx" ON "WalletBotAccess"("botId");

-- AddForeignKey
ALTER TABLE "BotUser" ADD CONSTRAINT "BotUser_botKeyId_fkey" FOREIGN KEY ("botKeyId") REFERENCES "BotKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
