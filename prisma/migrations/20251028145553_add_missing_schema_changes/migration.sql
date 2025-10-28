-- CreateTable
CREATE TABLE "Proxy" (
    "id" TEXT NOT NULL,
    "walletId" TEXT,
    "proxyAddress" TEXT NOT NULL,
    "authTokenId" TEXT NOT NULL,
    "paramUtxo" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,

    CONSTRAINT "Proxy_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "Migration" (
    "id" TEXT NOT NULL,
    "originalWalletId" TEXT NOT NULL,
    "newWalletId" TEXT,
    "ownerAddress" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "migrationData" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Migration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Migration_ownerAddress_idx" ON "Migration"("ownerAddress");

-- CreateIndex
CREATE INDEX "Migration_originalWalletId_idx" ON "Migration"("originalWalletId");

-- CreateIndex
CREATE INDEX "Migration_status_idx" ON "Migration"("status");

-- CreateIndex
CREATE INDEX "Migration_createdAt_idx" ON "Migration"("createdAt");
