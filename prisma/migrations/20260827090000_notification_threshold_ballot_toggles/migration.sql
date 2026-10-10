-- Two new per-wallet × per-signer email toggles:
--   notifyThresholdReached — a transaction/payload collected enough signatures
--   notifyBallotDeadlines  — proposals in a ballot stop accepting votes soon
-- Both default on, matching the existing signature toggles.
ALTER TABLE "WalletSignerNotificationSetting"
  ADD COLUMN "notifyThresholdReached" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyBallotDeadlines" BOOLEAN NOT NULL DEFAULT true;
