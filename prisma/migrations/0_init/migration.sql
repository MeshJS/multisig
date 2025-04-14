-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "stakeAddress" TEXT NOT NULL,
    "nostrKey" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "signersAddresses" TEXT[],
    "signersDescriptions" TEXT[],
    "numRequiredSigners" INTEGER,
    "verified" TEXT[],
    "scriptCbor" TEXT NOT NULL,
    "stakeCredentialHash" TEXT,
    "type" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "txJson" TEXT NOT NULL,
    "txCbor" TEXT NOT NULL,
    "signedAddresses" TEXT[],
    "rejectedAddresses" TEXT[],
    "description" TEXT,
    "state" INTEGER NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewWallet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "signersAddresses" TEXT[],
    "signersDescriptions" TEXT[],
    "ownerAddress" TEXT NOT NULL,

    CONSTRAINT "NewWallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_address_key" ON "User"("address");

-- CreateIndex
CREATE UNIQUE INDEX "User_stakeAddress_key" ON "User"("stakeAddress");

-- CreateIndex
CREATE UNIQUE INDEX "User_nostrKey_key" ON "User"("nostrKey");

