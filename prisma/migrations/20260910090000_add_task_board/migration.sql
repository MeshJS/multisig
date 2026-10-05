-- Project task board with multisig payouts.
--
-- Task is the kanban card (status = column). TaskRecipient holds the payment
-- lines in base units. TaskPayout links a task to the pending/submitted
-- Transaction that pays it; Transaction has no relations in this schema, so
-- transactionId is a plain indexed column.

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('Backlog', 'InProgress', 'InReview', 'Done');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('Low', 'Medium', 'High');

-- CreateEnum
CREATE TYPE "TaskPayoutStatus" AS ENUM ('Pending', 'Paid', 'Cancelled');

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'Backlog',
    "priority" "TaskPriority",
    "assigneeAddress" TEXT,
    "dueDate" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskRecipient" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "label" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TaskRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskPayout" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "status" "TaskPayoutStatus" NOT NULL DEFAULT 'Pending',
    "txHash" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "TaskPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_walletId_idx" ON "Task"("walletId");

-- CreateIndex
CREATE INDEX "Task_walletId_status_position_idx" ON "Task"("walletId", "status", "position");

-- CreateIndex
CREATE INDEX "TaskRecipient_taskId_idx" ON "TaskRecipient"("taskId");

-- CreateIndex
CREATE INDEX "TaskPayout_walletId_idx" ON "TaskPayout"("walletId");

-- CreateIndex
CREATE INDEX "TaskPayout_taskId_idx" ON "TaskPayout"("taskId");

-- CreateIndex
CREATE INDEX "TaskPayout_transactionId_idx" ON "TaskPayout"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskPayout_taskId_transactionId_key" ON "TaskPayout"("taskId", "transactionId");

-- AddForeignKey
ALTER TABLE "TaskRecipient" ADD CONSTRAINT "TaskRecipient_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPayout" ADD CONSTRAINT "TaskPayout_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row Level Security, in the migration that creates the tables (see
-- 20251215090000_enable_rls_disable_postgrest and the note in
-- 20260823090000_enable_rls_document_draft_attestation): RLS on
-- unconditionally, deny-all policies for the PostgREST roles only when those
-- roles exist; Prisma connects as the table owner and bypasses RLS.
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY['Task', 'TaskRecipient', 'TaskPayout'])
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
