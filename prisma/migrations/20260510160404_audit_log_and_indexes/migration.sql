-- AlterTable
ALTER TABLE "Ballot" ALTER COLUMN "anchorUrls" SET DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "anchorHashes" SET DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorAddress" TEXT,
    "actorType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_actorAddress_idx" ON "AuditLog"("actorAddress");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorAddress_createdAt_idx" ON "AuditLog"("actorAddress", "createdAt");

-- CreateIndex
CREATE INDEX "BalanceSnapshot_walletId_idx" ON "BalanceSnapshot"("walletId");

-- CreateIndex
CREATE INDEX "BalanceSnapshot_walletId_snapshotDate_idx" ON "BalanceSnapshot"("walletId", "snapshotDate");

-- CreateIndex
CREATE INDEX "Ballot_walletId_idx" ON "Ballot"("walletId");

-- CreateIndex
CREATE INDEX "NewWallet_ownerAddress_idx" ON "NewWallet"("ownerAddress");

-- CreateIndex
CREATE INDEX "NewWallet_signersAddresses_idx" ON "NewWallet" USING GIN ("signersAddresses" array_ops);

-- CreateIndex
CREATE INDEX "Proxy_walletId_idx" ON "Proxy"("walletId");

-- CreateIndex
CREATE INDEX "Proxy_userId_idx" ON "Proxy"("userId");

-- CreateIndex
CREATE INDEX "Proxy_walletId_isActive_idx" ON "Proxy"("walletId", "isActive");

-- CreateIndex
CREATE INDEX "Proxy_userId_isActive_idx" ON "Proxy"("userId", "isActive");

-- CreateIndex
CREATE INDEX "Signable_walletId_idx" ON "Signable"("walletId");

-- CreateIndex
CREATE INDEX "Signable_state_idx" ON "Signable"("state");

-- CreateIndex
CREATE INDEX "Signable_walletId_state_idx" ON "Signable"("walletId", "state");

-- CreateIndex
CREATE INDEX "Transaction_walletId_idx" ON "Transaction"("walletId");

-- CreateIndex
CREATE INDEX "Transaction_state_idx" ON "Transaction"("state");

-- CreateIndex
CREATE INDEX "Transaction_walletId_state_idx" ON "Transaction"("walletId", "state");

-- CreateIndex
CREATE INDEX "Wallet_ownerAddress_idx" ON "Wallet"("ownerAddress");

-- CreateIndex
CREATE INDEX "Wallet_signersAddresses_idx" ON "Wallet" USING GIN ("signersAddresses" array_ops);

