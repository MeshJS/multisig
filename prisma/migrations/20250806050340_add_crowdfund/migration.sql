-- CreateTable
CREATE TABLE "Crowdfund" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "proposerKeyHashR0" TEXT NOT NULL,
    "authTokenId" TEXT,
    "datum" TEXT,
    "address" TEXT,

    CONSTRAINT "Crowdfund_pkey" PRIMARY KEY ("id")
);
