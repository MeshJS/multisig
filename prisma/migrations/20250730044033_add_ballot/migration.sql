-- CreateTable
CREATE TABLE "Ballot" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "description" TEXT,
    "items" TEXT[],
    "itemDescriptions" TEXT[],
    "choices" TEXT[],
    "type" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ballot_pkey" PRIMARY KEY ("id")
);
