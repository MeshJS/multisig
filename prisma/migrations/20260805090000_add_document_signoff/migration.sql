-- Document Sign-Off (PRD-001) — five-entity model.
--
-- Approval binds to an exact content hash on a DocumentVersion, never to the
-- mutable Document container. DocumentSignerSnapshot freezes the wallet's
-- signer set + threshold at review start so later membership changes cannot
-- rewrite history. DocumentEvent is append-only and feeds the proof export.

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('Draft', 'InReview', 'Approved', 'Rejected', 'Superseded', 'Archived');

-- CreateEnum
CREATE TYPE "DocumentReviewAction" AS ENUM ('approve', 'reject');

-- CreateEnum
CREATE TYPE "DocumentStorageMode" AS ENUM ('hashOnly', 'inline', 'external');

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "documentType" TEXT,
    "createdBy" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'Draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "hashAlgorithm" TEXT NOT NULL DEFAULT 'sha256',
    "fileName" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "storageMode" "DocumentStorageMode" NOT NULL DEFAULT 'hashOnly',
    "contentRef" TEXT,
    "contentInline" TEXT,
    "reviewInstructions" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'Draft',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewStartedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentReview" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "signerAddress" TEXT NOT NULL,
    "action" "DocumentReviewAction" NOT NULL,
    "comment" TEXT,
    "payload" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "signatureKey" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSignerSnapshot" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "signersAddresses" TEXT[],
    "signersDescriptions" TEXT[],
    "requiredSigners" INTEGER NOT NULL,
    "walletPolicyHash" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSignerSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentEvent" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionId" TEXT,
    "type" TEXT NOT NULL,
    "actorAddress" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_walletId_idx" ON "Document"("walletId");

-- CreateIndex
CREATE INDEX "Document_walletId_status_idx" ON "Document"("walletId", "status");

-- CreateIndex
CREATE INDEX "Document_createdBy_idx" ON "Document"("createdBy");

-- CreateIndex
CREATE INDEX "DocumentVersion_documentId_idx" ON "DocumentVersion"("documentId");

-- CreateIndex
CREATE INDEX "DocumentVersion_contentHash_idx" ON "DocumentVersion"("contentHash");

-- CreateIndex
CREATE INDEX "DocumentVersion_status_idx" ON "DocumentVersion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_versionNumber_key" ON "DocumentVersion"("documentId", "versionNumber");

-- CreateIndex
CREATE INDEX "DocumentReview_versionId_idx" ON "DocumentReview"("versionId");

-- CreateIndex
CREATE INDEX "DocumentReview_signerAddress_idx" ON "DocumentReview"("signerAddress");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentReview_versionId_signerAddress_key" ON "DocumentReview"("versionId", "signerAddress");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSignerSnapshot_versionId_key" ON "DocumentSignerSnapshot"("versionId");

-- CreateIndex
CREATE INDEX "DocumentSignerSnapshot_walletId_idx" ON "DocumentSignerSnapshot"("walletId");

-- CreateIndex
CREATE INDEX "DocumentEvent_documentId_createdAt_idx" ON "DocumentEvent"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentEvent_versionId_idx" ON "DocumentEvent"("versionId");

-- CreateIndex
CREATE INDEX "DocumentEvent_type_idx" ON "DocumentEvent"("type");

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReview" ADD CONSTRAINT "DocumentReview_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSignerSnapshot" ADD CONSTRAINT "DocumentSignerSnapshot_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentEvent" ADD CONSTRAINT "DocumentEvent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentEvent" ADD CONSTRAINT "DocumentEvent_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security — same contract as 20251215090000_enable_rls_disable_postgrest
-- and 20260706100000_enable_rls_followup_tables: RLS on unconditionally, deny-all
-- policies for the PostgREST roles when those roles exist. Prisma connects as the
-- table owner / service role and continues to bypass RLS.
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'Document', 'DocumentVersion', 'DocumentReview',
      'DocumentSignerSnapshot', 'DocumentEvent'
    ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format(
        'CREATE POLICY "deny_all_anon_%s" ON %I FOR ALL TO anon USING (false) WITH CHECK (false)',
        tbl, tbl
      );
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format(
        'CREATE POLICY "deny_all_authenticated_%s" ON %I FOR ALL TO authenticated USING (false) WITH CHECK (false)',
        tbl, tbl
      );
    END IF;
  END LOOP;
END $$;
