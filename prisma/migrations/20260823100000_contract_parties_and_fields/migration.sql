-- CreateEnum
CREATE TYPE "DocumentSigningMode" AS ENUM ('threshold', 'parties');

-- CreateEnum
CREATE TYPE "ContractFieldKind" AS ENUM ('signature', 'initials', 'date', 'text', 'checkbox');

-- CreateEnum
CREATE TYPE "SignatureMethod" AS ENUM ('cip8Wallet', 'ausweisApp', 'eudiWallet');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "signingMode" "DocumentSigningMode" NOT NULL DEFAULT 'threshold';

-- AlterTable
ALTER TABLE "DocumentReview" ADD COLUMN     "method" "SignatureMethod" NOT NULL DEFAULT 'cip8Wallet',
ADD COLUMN     "partyId" TEXT;

-- CreateTable
CREATE TABLE "ContractParty" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "signingOrder" INTEGER NOT NULL DEFAULT 0,
    "inviteTokenHash" TEXT,
    "invitedAt" TIMESTAMP(3),
    "inviteExpiresAt" TIMESTAMP(3),
    "inviteConsumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractField" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "kind" "ContractFieldKind" NOT NULL,
    "label" TEXT,
    "anchor" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "value" TEXT,
    "filledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContractParty_inviteTokenHash_key" ON "ContractParty"("inviteTokenHash");

-- CreateIndex
CREATE INDEX "ContractParty_documentId_idx" ON "ContractParty"("documentId");

-- CreateIndex
CREATE INDEX "ContractParty_address_idx" ON "ContractParty"("address");

-- CreateIndex
CREATE INDEX "ContractParty_inviteExpiresAt_idx" ON "ContractParty"("inviteExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContractParty_documentId_address_key" ON "ContractParty"("documentId", "address");

-- CreateIndex
CREATE INDEX "ContractField_partyId_idx" ON "ContractField"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractField_documentId_anchor_key" ON "ContractField"("documentId", "anchor");

-- CreateIndex
CREATE INDEX "DocumentReview_partyId_idx" ON "DocumentReview"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentReview_versionId_partyId_key" ON "DocumentReview"("versionId", "partyId");

-- AddForeignKey
ALTER TABLE "DocumentReview" ADD CONSTRAINT "DocumentReview_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "ContractParty"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractParty" ADD CONSTRAINT "ContractParty_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractField" ADD CONSTRAINT "ContractField_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractField" ADD CONSTRAINT "ContractField_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "ContractParty"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row Level Security — same contract as 20251215090000_enable_rls_disable_postgrest
-- and the per-table blocks in 20260805090000_add_document_signoff: RLS on
-- unconditionally, deny-all policies for the PostgREST roles when those roles
-- exist, Prisma continues to bypass as the table owner / service role.
--
-- In this migration rather than a follow-up because ContractParty holds the only
-- identifiable third-party data in the document stack (a counterparty's email),
-- and because 20260823090000 is the precedent for what happens when it is
-- forgotten: two tables shipped with RLS off and needed a second migration.
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY['ContractParty', 'ContractField'])
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl) THEN
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
    END IF;
  END LOOP;
END $$;
