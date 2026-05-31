-- AlterTable
ALTER TABLE "MachineTemplate" ADD COLUMN     "goldenImageId" TEXT;

-- CreateTable
CREATE TABLE "GoldenImage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "osType" TEXT NOT NULL,
    "osVersion" TEXT,
    "baseDiskPath" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'building',
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentImageId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceMachineId" TEXT,
    "sourceTemplateId" TEXT,
    "hardeningApplied" JSONB,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sealedAt" TIMESTAMP(3),
    "deprecatedAt" TIMESTAMP(3),

    CONSTRAINT "GoldenImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoldenImage_status_idx" ON "GoldenImage"("status");

-- CreateIndex
CREATE INDEX "GoldenImage_osType_status_idx" ON "GoldenImage"("osType", "status");

-- CreateIndex
CREATE INDEX "GoldenImage_parentImageId_idx" ON "GoldenImage"("parentImageId");

-- CreateIndex
CREATE INDEX "MachineTemplate_goldenImageId_idx" ON "MachineTemplate"("goldenImageId");

-- AddForeignKey
ALTER TABLE "MachineTemplate" ADD CONSTRAINT "MachineTemplate_goldenImageId_fkey" FOREIGN KEY ("goldenImageId") REFERENCES "GoldenImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoldenImage" ADD CONSTRAINT "GoldenImage_parentImageId_fkey" FOREIGN KEY ("parentImageId") REFERENCES "GoldenImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
