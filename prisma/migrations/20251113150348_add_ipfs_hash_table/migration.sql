-- CreateTable
CREATE TABLE "IpfsHash" (
    "id" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "ipfsCid" TEXT NOT NULL,
    "userAddress" TEXT,
    "walletId" TEXT,
    "pathname" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IpfsHash_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IpfsHash_contentHash_idx" ON "IpfsHash"("contentHash");

-- CreateIndex
CREATE INDEX "IpfsHash_userAddress_idx" ON "IpfsHash"("userAddress");

-- CreateIndex
CREATE INDEX "IpfsHash_walletId_idx" ON "IpfsHash"("walletId");

-- CreateIndex
CREATE INDEX "IpfsHash_ipfsCid_idx" ON "IpfsHash"("ipfsCid");


