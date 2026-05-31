-- DropForeignKey
ALTER TABLE "public"."Automation" DROP CONSTRAINT "Automation_createdById_fkey";

-- DropForeignKey
ALTER TABLE "public"."Automation" DROP CONSTRAINT "Automation_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AutomationExecution" DROP CONSTRAINT "AutomationExecution_automationId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AutomationExecution" DROP CONSTRAINT "AutomationExecution_machineId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AutomationExecution" DROP CONSTRAINT "AutomationExecution_scriptExecutionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AutomationExecution" DROP CONSTRAINT "AutomationExecution_snapshotId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AutomationRecommendation" DROP CONSTRAINT "AutomationRecommendation_actionTakenById_fkey";

-- DropForeignKey
ALTER TABLE "public"."AutomationRecommendation" DROP CONSTRAINT "AutomationRecommendation_automationId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AutomationRecommendation" DROP CONSTRAINT "AutomationRecommendation_executionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AutomationRecommendation" DROP CONSTRAINT "AutomationRecommendation_machineId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AutomationRecommendation" DROP CONSTRAINT "AutomationRecommendation_scriptExecutionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AutomationRecommendation" DROP CONSTRAINT "AutomationRecommendation_scriptId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AutomationRecommendation" DROP CONSTRAINT "AutomationRecommendation_systemScriptId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AutomationScript" DROP CONSTRAINT "AutomationScript_automationId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AutomationScript" DROP CONSTRAINT "AutomationScript_scriptId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AutomationScript" DROP CONSTRAINT "AutomationScript_systemScriptId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AutomationTarget" DROP CONSTRAINT "AutomationTarget_automationId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AutomationTarget" DROP CONSTRAINT "AutomationTarget_machineId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AutomationVersion" DROP CONSTRAINT "AutomationVersion_automationId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AutomationVersion" DROP CONSTRAINT "AutomationVersion_changedById_fkey";

-- DropForeignKey
ALTER TABLE "public"."CustomBlock" DROP CONSTRAINT "CustomBlock_createdById_fkey";

-- DropForeignKey
ALTER TABLE "public"."SystemScript" DROP CONSTRAINT "SystemScript_createdById_fkey";

-- AlterTable
ALTER TABLE "VMRecommendation" ADD COLUMN     "checkerName" TEXT,
ADD COLUMN     "packageId" TEXT;

-- DropTable
DROP TABLE "public"."Automation";

-- DropTable
DROP TABLE "public"."AutomationExecution";

-- DropTable
DROP TABLE "public"."AutomationRecommendation";

-- DropTable
DROP TABLE "public"."AutomationScript";

-- DropTable
DROP TABLE "public"."AutomationTarget";

-- DropTable
DROP TABLE "public"."AutomationTemplate";

-- DropTable
DROP TABLE "public"."AutomationVersion";

-- DropTable
DROP TABLE "public"."CustomBlock";

-- DropTable
DROP TABLE "public"."SystemScript";

-- DropEnum
DROP TYPE "public"."AutomationExecutionStatus";

-- DropEnum
DROP TYPE "public"."AutomationRecommendationStatus";

-- DropEnum
DROP TYPE "public"."AutomationScope";

-- DropEnum
DROP TYPE "public"."AutomationStatus";

-- DropEnum
DROP TYPE "public"."BlockOutputType";

-- DropEnum
DROP TYPE "public"."RecommendationSeverity";

-- DropEnum
DROP TYPE "public"."RecommendationUserAction";

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "author" TEXT NOT NULL,
    "license" TEXT NOT NULL,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "capabilities" JSONB NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "manifestHash" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageChecker" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dataNeeds" TEXT[],
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PackageChecker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Package_name_key" ON "Package"("name");

-- CreateIndex
CREATE INDEX "Package_isEnabled_idx" ON "Package"("isEnabled");

-- CreateIndex
CREATE INDEX "Package_license_idx" ON "Package"("license");

-- CreateIndex
CREATE INDEX "PackageChecker_packageId_idx" ON "PackageChecker"("packageId");

-- CreateIndex
CREATE INDEX "PackageChecker_isEnabled_idx" ON "PackageChecker"("isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "PackageChecker_packageId_name_key" ON "PackageChecker"("packageId", "name");

-- CreateIndex
CREATE INDEX "VMRecommendation_packageId_idx" ON "VMRecommendation"("packageId");

-- AddForeignKey
ALTER TABLE "PackageChecker" ADD CONSTRAINT "PackageChecker_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

