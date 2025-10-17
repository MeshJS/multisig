-- CreateTable
CREATE TABLE "BalanceSnapshot" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "walletName" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "adaBalance" DECIMAL(65,30) NOT NULL,
    "assetBalances" JSONB NOT NULL,
    "isArchived" BOOLEAN NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BalanceSnapshot_snapshotDate_idx" ON "BalanceSnapshot"("snapshotDate");

-- CreateIndex
CREATE INDEX "BalanceSnapshot_walletId_idx" ON "BalanceSnapshot"("walletId");
