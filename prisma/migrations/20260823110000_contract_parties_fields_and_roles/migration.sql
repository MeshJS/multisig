-- CreateEnum
CREATE TYPE "DocumentSigningMode" AS ENUM ('threshold', 'parties');

-- CreateEnum
CREATE TYPE "ContractFieldKind" AS ENUM ('signature', 'initials', 'date', 'text', 'checkbox');

-- CreateEnum
CREATE TYPE "SignatureMethod" AS ENUM ('cip8Wallet', 'ausweisApp', 'eudiWallet');

-- DropIndex
DROP INDEX "DocumentReview_versionId_signerAddress_key";

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
    "required" BOOLEAN NOT NULL DEFAULT true,
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


-- Threshold mode keeps its one-action-per-signer guarantee.
--
-- Dropping DocumentReview_versionId_signerAddress_key above is the direct cost
-- of letting one human hold two roles: a tenant who is also their own guarantor
-- signs the same version twice, once per capacity. But that only applies to
-- party-attributed reviews. For wallet-threshold sign-off — every row where
-- partyId IS NULL — one signer acting twice on one version is still wrong, and
-- the in-transaction "has already acted" check reads rows fetched before the
-- write, so it cannot stop two concurrent submissions on its own.
--
-- A partial unique index restores exactly the old guarantee, exactly where it
-- still holds. Prisma cannot express `WHERE` on @@unique, so it lives here.
--
-- KEEP THIS. Migrations in this repo are generated with
-- `prisma migrate diff --from-schema <old> --to-schema <new>`, which compares
-- two schema files and never sees this index, so it will not be dropped by
-- accident — but a diff taken `--from-migrations` would propose removing it.
CREATE UNIQUE INDEX "DocumentReview_versionId_signerAddress_threshold_key"
  ON "DocumentReview" ("versionId", "signerAddress")
  WHERE "partyId" IS NULL;

-- Row Level Security — same contract as 20251215090000_enable_rls_disable_postgrest
-- and the per-table block in 20260805090000_add_document_signoff. In this
-- migration rather than a follow-up because ContractParty holds the only
-- identifiable third-party data in the document stack (a counterparty's email),
-- and 20260823090000 is the precedent for what happens when it is forgotten.
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
