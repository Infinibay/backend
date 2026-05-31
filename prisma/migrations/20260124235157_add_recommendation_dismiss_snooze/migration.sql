-- AlterTable
ALTER TABLE "VMRecommendation" ADD COLUMN     "dismissedAt" TIMESTAMP(3),
ADD COLUMN     "snoozedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PackageLicense" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "licenseKey" TEXT NOT NULL,
    "licenseType" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "maxMachines" INTEGER,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "validationStatus" TEXT NOT NULL DEFAULT 'valid',
    "lastValidatedAt" TIMESTAMP(3),
    "gracePeriodEnds" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackageLicense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PackageLicense_packageId_key" ON "PackageLicense"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "PackageLicense_licenseKey_key" ON "PackageLicense"("licenseKey");

-- CreateIndex
CREATE INDEX "PackageLicense_isValid_idx" ON "PackageLicense"("isValid");

-- CreateIndex
CREATE INDEX "PackageLicense_licenseType_idx" ON "PackageLicense"("licenseType");

-- CreateIndex
CREATE INDEX "PackageLicense_validationStatus_idx" ON "PackageLicense"("validationStatus");

-- CreateIndex
CREATE INDEX "VMRecommendation_dismissedAt_idx" ON "VMRecommendation"("dismissedAt");

-- CreateIndex
CREATE INDEX "VMRecommendation_snoozedUntil_idx" ON "VMRecommendation"("snoozedUntil");

-- AddForeignKey
ALTER TABLE "PackageLicense" ADD CONSTRAINT "PackageLicense_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;
