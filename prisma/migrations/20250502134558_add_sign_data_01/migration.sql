-- CreateTable
CREATE TABLE "Signable" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "signatures" TEXT[],
    "signedAddresses" TEXT[],
    "rejectedAddresses" TEXT[],
    "description" TEXT,
    "method" TEXT,
    "state" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Signable_pkey" PRIMARY KEY ("id")
);
