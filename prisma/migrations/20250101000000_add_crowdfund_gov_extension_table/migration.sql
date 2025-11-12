-- CreateTable
CREATE TABLE "CrowdfundGovExtension" (
    "id" TEXT NOT NULL,
    "crowdfundId" TEXT NOT NULL,
    "gov_action_period" INTEGER,
    "delegate_pool_id" TEXT,
    "gov_action" JSONB,
    "stake_register_deposit" INTEGER,
    "drep_register_deposit" INTEGER,
    "gov_deposit" INTEGER,
    "govActionMetadataUrl" TEXT,
    "govActionMetadataHash" TEXT,
    "drepMetadataUrl" TEXT,
    "drepMetadataHash" TEXT,
    "govAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrowdfundGovExtension_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrowdfundGovExtension_crowdfundId_key" ON "CrowdfundGovExtension"("crowdfundId");

-- AddForeignKey
ALTER TABLE "CrowdfundGovExtension" ADD CONSTRAINT "CrowdfundGovExtension_crowdfundId_fkey" FOREIGN KEY ("crowdfundId") REFERENCES "Crowdfund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing data from govDatum JSON to new table
INSERT INTO "CrowdfundGovExtension" (
    "id",
    "crowdfundId",
    "gov_action_period",
    "delegate_pool_id",
    "gov_action",
    "stake_register_deposit",
    "drep_register_deposit",
    "gov_deposit",
    "govActionMetadataUrl",
    "govActionMetadataHash",
    "drepMetadataUrl",
    "drepMetadataHash",
    "govAddress",
    "createdAt",
    "updatedAt"
)
SELECT 
    gen_random_uuid()::text as "id",
    c.id as "crowdfundId",
    (c."govDatum"::jsonb->>'gov_action_period')::integer as "gov_action_period",
    c."govDatum"::jsonb->>'delegate_pool_id' as "delegate_pool_id",
    c."govDatum"::jsonb->'gov_action' as "gov_action",
    (c."govDatum"::jsonb->>'stake_register_deposit')::integer as "stake_register_deposit",
    (c."govDatum"::jsonb->>'drep_register_deposit')::integer as "drep_register_deposit",
    (c."govDatum"::jsonb->>'gov_deposit')::integer as "gov_deposit",
    c."govDatum"::jsonb->>'govActionMetadataUrl' as "govActionMetadataUrl",
    c."govDatum"::jsonb->>'govActionMetadataHash' as "govActionMetadataHash",
    c."govDatum"::jsonb->>'drepMetadataUrl' as "drepMetadataUrl",
    c."govDatum"::jsonb->>'drepMetadataHash' as "drepMetadataHash",
    COALESCE(c."govAddress", c."govDatum"::jsonb->>'govAddress') as "govAddress",
    c."createdAt" as "createdAt",
    CURRENT_TIMESTAMP as "updatedAt"
FROM "Crowdfund" c
WHERE c."govDatum" IS NOT NULL 
  AND c."govDatum" != ''
  AND NOT EXISTS (
    SELECT 1 FROM "CrowdfundGovExtension" cge WHERE cge."crowdfundId" = c.id
  );

