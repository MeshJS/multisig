-- AlterTable
ALTER TABLE "CrowdfundGovExtension" ALTER COLUMN "stake_register_deposit" SET DATA TYPE BIGINT USING "stake_register_deposit"::BIGINT;
ALTER TABLE "CrowdfundGovExtension" ALTER COLUMN "drep_register_deposit" SET DATA TYPE BIGINT USING "drep_register_deposit"::BIGINT;
ALTER TABLE "CrowdfundGovExtension" ALTER COLUMN "gov_deposit" SET DATA TYPE BIGINT USING "gov_deposit"::BIGINT;

