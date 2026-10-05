-- CreateTable
CREATE TABLE "ProxyMember" (
    "id" TEXT NOT NULL,
    "proxyId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "label" TEXT,
    "invitedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProxyMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProxyMember_proxyId_idx" ON "ProxyMember"("proxyId");

-- CreateIndex
CREATE INDEX "ProxyMember_address_idx" ON "ProxyMember"("address");

-- CreateIndex
CREATE UNIQUE INDEX "ProxyMember_proxyId_address_key" ON "ProxyMember"("proxyId", "address");

-- Match the RLS posture applied to every other table (see
-- 20251215090000_enable_rls_disable_postgrest): RLS on unconditionally, plus
-- deny-all policies for the PostgREST roles when they exist. Prisma connects
-- with the service role and keeps bypassing RLS.
DO $$
BEGIN
  ALTER TABLE "ProxyMember" ENABLE ROW LEVEL SECURITY;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE POLICY "deny_all_anon_ProxyMember" ON "ProxyMember"
      FOR ALL TO anon USING (false) WITH CHECK (false);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY "deny_all_authenticated_ProxyMember" ON "ProxyMember"
      FOR ALL TO authenticated USING (false) WITH CHECK (false);
  END IF;
END $$;
