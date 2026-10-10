-- Enable Row Level Security (RLS) and deny-all policies for PostgREST roles
-- on tables created after 20251215090000_enable_rls_disable_postgrest.
-- Covers the Supabase security advisor's rls_disabled_in_public findings
-- (PendingBot, BotClaimToken, AuditLog, Contact, WalletBotAccess, BotKey,
-- BotUser) plus tables that land in the same deploy and would be flagged
-- next (ProposalTally, notification center tables).
--
-- Same contract as the original migration:
-- - Enables RLS on each table unconditionally (skipping tables that don't exist)
-- - Only creates deny-all policies for `anon` and `authenticated` roles if they exist
-- - Prisma (service role / table owner) continues to bypass RLS

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'PendingBot', 'BotClaimToken', 'BotUser', 'BotKey', 'WalletBotAccess',
      'Contact', 'AuditLog', 'ProposalTally',
      'WalletSignerNotificationSetting', 'EmailVerificationToken', 'NotificationDelivery'
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
