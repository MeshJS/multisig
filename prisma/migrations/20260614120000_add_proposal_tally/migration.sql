-- CreateTable
CREATE TABLE "ProposalTally" (
    "id" TEXT NOT NULL,
    "network" INTEGER NOT NULL,
    "proposalId" TEXT NOT NULL,
    "yes" INTEGER NOT NULL DEFAULT 0,
    "no" INTEGER NOT NULL DEFAULT 0,
    "abstain" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "capped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposalTally_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProposalTally_network_proposalId_key" ON "ProposalTally"("network", "proposalId");
