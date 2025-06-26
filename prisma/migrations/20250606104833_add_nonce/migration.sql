-- CreateTable
CREATE TABLE "Nonce" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Nonce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Nonce_address_key" ON "Nonce"("address");
