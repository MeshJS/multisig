-- CreateEnum
CREATE TYPE "PendingBotStatus" AS ENUM ('UNCLAIMED', 'CLAIMED');

-- CreateTable
CREATE TABLE "PendingBot" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paymentAddress" TEXT NOT NULL,
    "stakeAddress" TEXT,
    "requestedScopes" TEXT NOT NULL,
    "status" "PendingBotStatus" NOT NULL DEFAULT 'UNCLAIMED',
    "claimedBy" TEXT,
    "secretCipher" TEXT,
    "pickedUp" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingBot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotClaimToken" (
    "id" TEXT NOT NULL,
    "pendingBotId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotClaimToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingBot_paymentAddress_idx" ON "PendingBot"("paymentAddress");

-- CreateIndex
CREATE INDEX "PendingBot_expiresAt_idx" ON "PendingBot"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BotClaimToken_pendingBotId_key" ON "BotClaimToken"("pendingBotId");

-- CreateIndex
CREATE INDEX "BotClaimToken_tokenHash_idx" ON "BotClaimToken"("tokenHash");

-- AddForeignKey
ALTER TABLE "BotClaimToken" ADD CONSTRAINT "BotClaimToken_pendingBotId_fkey" FOREIGN KEY ("pendingBotId") REFERENCES "PendingBot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
