-- Row Level Security for DocumentDraft and DocumentAttestation.
--
-- Every other table in this schema gets RLS in the migration that creates it —
-- see 20251215090000_enable_rls_disable_postgrest, its follow-up
-- 20260706100000_enable_rls_followup_tables, and the per-table blocks in
-- 20260805090000_add_document_signoff and 20260813000000_add_proxy_member.
-- These two tables were added without it, so they are the only ones in the
-- schema that PostgREST's anon and authenticated roles are not denied on.
--
-- That matters more for these two than for most: DocumentDraft is the one table
-- in the document stack that holds document BODIES rather than hashes, and
-- DocumentAttestation holds the signed notary chain.
--
-- Written as a follow-up rather than by editing those migrations, because a
-- migration that any environment has already applied cannot be edited without a
-- checksum failure on the next deploy — and this repo ships migrations through
-- an action that does not self-retry, so a failed deploy blocks every later
-- migration too.
--
-- Same contract as the migrations above: RLS on unconditionally, deny-all
-- policies for the PostgREST roles only when those roles exist, and Prisma
-- continues to connect as the table owner / service role and bypass RLS.
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY['DocumentDraft', 'DocumentAttestation'])
  LOOP
    -- Skip tables that don't exist
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
