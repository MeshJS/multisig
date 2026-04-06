-- Enable Row Level Security (RLS) and deny-all policies for PostgREST roles
-- This migration is designed for Supabase but is safe to run on any PostgreSQL:
-- - Enables RLS on all tables unconditionally
-- - Only creates deny-all policies for `anon` and `authenticated` roles if they exist
-- - Allows Prisma (using the service role) to continue bypassing RLS

DO $$
DECLARE
  tbl TEXT;
BEGIN
  -- Enable RLS and optionally create deny-all policies for each table that exists
  FOR tbl IN
    SELECT unnest(ARRAY[
      'User', 'Wallet', 'Transaction', 'Signable', 'NewWallet',
      'Nonce', 'Ballot', 'Proxy', 'BalanceSnapshot', 'Migration',
      'Crowdfund', '_prisma_migrations'
    ])
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
