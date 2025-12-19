-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contact_walletId_idx" ON "Contact"("walletId");

-- CreateIndex
CREATE INDEX "Contact_address_idx" ON "Contact"("address");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_walletId_address_key" ON "Contact"("walletId", "address");

