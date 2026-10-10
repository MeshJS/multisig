-- CreateTable
CREATE TABLE "WalletSignerNotificationSetting" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "signerAddress" TEXT NOT NULL,
    "email" TEXT,
    "emailNormalized" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "emailOptIn" BOOLEAN NOT NULL DEFAULT true,
    "notifyTransactionSignatures" BOOLEAN NOT NULL DEFAULT true,
    "notifySignableSignatures" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletSignerNotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "signerAddress" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipientAddress" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "walletId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider" TEXT,
    "providerMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletSignerNotificationSetting_walletId_signerAddress_key" ON "WalletSignerNotificationSetting"("walletId", "signerAddress");

-- CreateIndex
CREATE INDEX "WalletSignerNotificationSetting_walletId_idx" ON "WalletSignerNotificationSetting"("walletId");

-- CreateIndex
CREATE INDEX "WalletSignerNotificationSetting_signerAddress_idx" ON "WalletSignerNotificationSetting"("signerAddress");

-- CreateIndex
CREATE INDEX "WalletSignerNotificationSetting_emailNormalized_idx" ON "WalletSignerNotificationSetting"("emailNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_walletId_signerAddress_idx" ON "EmailVerificationToken"("walletId", "signerAddress");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_expiresAt_idx" ON "EmailVerificationToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_idempotencyKey_key" ON "NotificationDelivery"("idempotencyKey");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_recipientAddress_idx" ON "NotificationDelivery"("recipientAddress");

-- CreateIndex
CREATE INDEX "NotificationDelivery_walletId_idx" ON "NotificationDelivery"("walletId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_resourceType_resourceId_idx" ON "NotificationDelivery"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_pending_idx"
ON "NotificationDelivery" ("nextAttemptAt", "createdAt")
WHERE "status" IN ('pending', 'retrying');
