-- Enable Row Level Security (RLS) and deny-all policies for PostgREST roles
-- This migration is designed for Supabase but is safe to run on any PostgreSQL:
-- - Enables RLS on all tables unconditionally
-- - Only creates deny-all policies for `anon` and `authenticated` roles if they exist
-- - Allows Prisma (using the service role) to continue bypassing RLS

DO $$
BEGIN
  -- Enable RLS on all tables
  ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "Wallet" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "Transaction" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "Signable" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "NewWallet" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "Nonce" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "Ballot" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "Proxy" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "BalanceSnapshot" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "Migration" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "Crowdfund" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

  -- Create deny-all policies for anon role (Supabase PostgREST)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE POLICY "deny_all_anon_User" ON "User" FOR ALL TO anon USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_anon_Wallet" ON "Wallet" FOR ALL TO anon USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_anon_Transaction" ON "Transaction" FOR ALL TO anon USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_anon_Signable" ON "Signable" FOR ALL TO anon USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_anon_NewWallet" ON "NewWallet" FOR ALL TO anon USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_anon_Nonce" ON "Nonce" FOR ALL TO anon USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_anon_Ballot" ON "Ballot" FOR ALL TO anon USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_anon_Proxy" ON "Proxy" FOR ALL TO anon USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_anon_BalanceSnapshot" ON "BalanceSnapshot" FOR ALL TO anon USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_anon_Migration" ON "Migration" FOR ALL TO anon USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_anon_Crowdfund" ON "Crowdfund" FOR ALL TO anon USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_anon__prisma_migrations" ON "_prisma_migrations" FOR ALL TO anon USING (false) WITH CHECK (false);
  END IF;

  -- Create deny-all policies for authenticated role (Supabase PostgREST)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY "deny_all_authenticated_User" ON "User" FOR ALL TO authenticated USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_authenticated_Wallet" ON "Wallet" FOR ALL TO authenticated USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_authenticated_Transaction" ON "Transaction" FOR ALL TO authenticated USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_authenticated_Signable" ON "Signable" FOR ALL TO authenticated USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_authenticated_NewWallet" ON "NewWallet" FOR ALL TO authenticated USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_authenticated_Nonce" ON "Nonce" FOR ALL TO authenticated USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_authenticated_Ballot" ON "Ballot" FOR ALL TO authenticated USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_authenticated_Proxy" ON "Proxy" FOR ALL TO authenticated USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_authenticated_BalanceSnapshot" ON "BalanceSnapshot" FOR ALL TO authenticated USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_authenticated_Migration" ON "Migration" FOR ALL TO authenticated USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_authenticated_Crowdfund" ON "Crowdfund" FOR ALL TO authenticated USING (false) WITH CHECK (false);
    CREATE POLICY "deny_all_authenticated__prisma_migrations" ON "_prisma_migrations" FOR ALL TO authenticated USING (false) WITH CHECK (false);
  END IF;
END $$;
