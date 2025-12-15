-- Enable Row Level Security (RLS) and deny-all policies for PostgREST roles
-- This migration is designed for Supabase:
-- - Blocks access for `anon` and `authenticated` roles (used by PostgREST)
-- - Allows Prisma (using the service role) to continue bypassing RLS

-- Helper comment:
-- Pattern applied for each table:
--   ALTER TABLE "TableName" ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY "deny_all_anon_TableName" ON "TableName"
--     FOR ALL TO anon USING (false) WITH CHECK (false);
--   CREATE POLICY "deny_all_authenticated_TableName" ON "TableName"
--     FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- =========================
-- User
-- =========================
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_anon_User" ON "User"
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_all_authenticated_User" ON "User"
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- =========================
-- Wallet
-- =========================
ALTER TABLE "Wallet" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_anon_Wallet" ON "Wallet"
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_all_authenticated_Wallet" ON "Wallet"
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- =========================
-- Transaction
-- =========================
ALTER TABLE "Transaction" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_anon_Transaction" ON "Transaction"
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_all_authenticated_Transaction" ON "Transaction"
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- =========================
-- Signable
-- =========================
ALTER TABLE "Signable" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_anon_Signable" ON "Signable"
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_all_authenticated_Signable" ON "Signable"
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- =========================
-- NewWallet
-- =========================
ALTER TABLE "NewWallet" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_anon_NewWallet" ON "NewWallet"
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_all_authenticated_NewWallet" ON "NewWallet"
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- =========================
-- Nonce
-- =========================
ALTER TABLE "Nonce" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_anon_Nonce" ON "Nonce"
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_all_authenticated_Nonce" ON "Nonce"
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- =========================
-- Ballot
-- =========================
ALTER TABLE "Ballot" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_anon_Ballot" ON "Ballot"
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_all_authenticated_Ballot" ON "Ballot"
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- =========================
-- Proxy
-- =========================
ALTER TABLE "Proxy" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_anon_Proxy" ON "Proxy"
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_all_authenticated_Proxy" ON "Proxy"
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- =========================
-- BalanceSnapshot
-- =========================
ALTER TABLE "BalanceSnapshot" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_anon_BalanceSnapshot" ON "BalanceSnapshot"
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_all_authenticated_BalanceSnapshot" ON "BalanceSnapshot"
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- =========================
-- Migration
-- =========================
ALTER TABLE "Migration" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_anon_Migration" ON "Migration"
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_all_authenticated_Migration" ON "Migration"
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- =========================
-- Crowdfund
-- =========================
-- Note: Crowdfund table exists in the database but is not defined in the current Prisma schema.
-- We still enable RLS and deny-all policies to secure its PostgREST exposure.
ALTER TABLE "Crowdfund" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_anon_Crowdfund" ON "Crowdfund"
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_all_authenticated_Crowdfund" ON "Crowdfund"
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- =========================
-- _prisma_migrations (optional system table)
-- =========================
-- While Prisma typically manages this table without RLS, enabling RLS here
-- and denying anon/authenticated helps ensure it is not exposed via PostgREST.
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_anon__prisma_migrations" ON "_prisma_migrations"
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "deny_all_authenticated__prisma_migrations" ON "_prisma_migrations"
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

