-- CreateTable
CREATE TABLE "DocumentAttestation" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "prevAttestationHash" TEXT NOT NULL,
    "attestationHash" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "publicKeyId" TEXT NOT NULL,
    "attestedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAttestation_versionId_key" ON "DocumentAttestation"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAttestation_attestationHash_key" ON "DocumentAttestation"("attestationHash");

-- CreateIndex
CREATE INDEX "DocumentAttestation_documentId_idx" ON "DocumentAttestation"("documentId");

-- CreateIndex
CREATE INDEX "DocumentAttestation_contentHash_idx" ON "DocumentAttestation"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAttestation_documentId_sequence_key" ON "DocumentAttestation"("documentId", "sequence");

-- AddForeignKey
ALTER TABLE "DocumentAttestation" ADD CONSTRAINT "DocumentAttestation_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

