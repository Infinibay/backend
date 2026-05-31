/*
  Warnings:

  - You are about to drop the column `isSystemScript` on the `Script` table. All the data in the column will be lost.
  - You are about to drop the column `scriptType` on the `Script` table. All the data in the column will be lost.
  - You are about to drop the column `detectionKey` on the `VMRecommendation` table. All the data in the column will be lost.
  - You are about to drop the `DepartmentDetectionAction` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DepartmentDetectionConfig` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DetectionAction` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DetectionDataSchema` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DetectionDefinition` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RecommendationAction` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "AutomationScope" AS ENUM ('ALL_VMS', 'DEPARTMENT', 'SPECIFIC_VMS', 'EXCLUDE_VMS');

-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AutomationExecutionStatus" AS ENUM ('PENDING', 'EVALUATING', 'TRIGGERED', 'EXECUTING_SCRIPT', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "BlockOutputType" AS ENUM ('BOOLEAN', 'NUMBER', 'STRING', 'ARRAY', 'VOID');

-- CreateEnum
CREATE TYPE "AutomationRecommendationStatus" AS ENUM ('PENDING', 'EXECUTED', 'DISMISSED', 'SNOOZED', 'AUTO_RESOLVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RecommendationSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RecommendationUserAction" AS ENUM ('EXECUTE', 'DISMISS', 'SNOOZE');

-- DropForeignKey
ALTER TABLE "public"."DepartmentDetectionAction" DROP CONSTRAINT "DepartmentDetectionAction_departmentDetectionConfigId_fkey";

-- DropForeignKey
ALTER TABLE "public"."DepartmentDetectionAction" DROP CONSTRAINT "DepartmentDetectionAction_scriptId_fkey";

-- DropForeignKey
ALTER TABLE "public"."DepartmentDetectionConfig" DROP CONSTRAINT "DepartmentDetectionConfig_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."DepartmentDetectionConfig" DROP CONSTRAINT "DepartmentDetectionConfig_detectionDefinitionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."DetectionAction" DROP CONSTRAINT "DetectionAction_detectionDefinitionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."DetectionAction" DROP CONSTRAINT "DetectionAction_scriptId_fkey";

-- DropForeignKey
ALTER TABLE "public"."DetectionDataSchema" DROP CONSTRAINT "DetectionDataSchema_detectionDefinitionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."DetectionDefinition" DROP CONSTRAINT "DetectionDefinition_createdByUserId_fkey";

-- DropForeignKey
ALTER TABLE "public"."RecommendationAction" DROP CONSTRAINT "RecommendationAction_executionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."RecommendationAction" DROP CONSTRAINT "RecommendationAction_recommendationId_fkey";

-- DropForeignKey
ALTER TABLE "public"."RecommendationAction" DROP CONSTRAINT "RecommendationAction_scriptId_fkey";

-- DropIndex
DROP INDEX "public"."VMRecommendation_detectionKey_idx";

-- AlterTable
ALTER TABLE "Script" DROP COLUMN "isSystemScript",
DROP COLUMN "scriptType";

-- AlterTable
ALTER TABLE "VMRecommendation" DROP COLUMN "detectionKey";

-- DropTable
DROP TABLE "public"."DepartmentDetectionAction";

-- DropTable
DROP TABLE "public"."DepartmentDetectionConfig";

-- DropTable
DROP TABLE "public"."DetectionAction";

-- DropTable
DROP TABLE "public"."DetectionDataSchema";

-- DropTable
DROP TABLE "public"."DetectionDefinition";

-- DropTable
DROP TABLE "public"."RecommendationAction";

-- DropEnum
DROP TYPE "public"."ActionStatus";

-- DropEnum
DROP TYPE "public"."ScriptType";

-- CreateTable
CREATE TABLE "SystemScript" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "codeWindows" TEXT,
    "codeLinux" TEXT,
    "category" TEXT NOT NULL DEFAULT 'General',
    "requiredHealthFields" TEXT[],
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemScript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomBlock" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "blockDefinition" JSONB NOT NULL,
    "generatorCode" TEXT NOT NULL,
    "inputs" JSONB NOT NULL DEFAULT '[]',
    "outputType" "BlockOutputType" NOT NULL,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "supportedOS" "OS"[] DEFAULT ARRAY['WINDOWS', 'LINUX']::"OS"[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "blocklyWorkspace" JSONB NOT NULL,
    "generatedCode" TEXT NOT NULL,
    "compiledCode" TEXT,
    "isCompiled" BOOLEAN NOT NULL DEFAULT false,
    "compilationError" TEXT,
    "targetScope" "AutomationScope" NOT NULL DEFAULT 'ALL_VMS',
    "departmentId" TEXT,
    "status" "AutomationStatus" NOT NULL DEFAULT 'DRAFT',
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
    "recommendationType" "RecommendationType",
    "recommendationText" TEXT,
    "recommendationActionText" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationTarget" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationScript" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "scriptId" TEXT,
    "systemScriptId" TEXT,
    "os" "OS" NOT NULL,
    "executionOrder" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationScript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationExecution" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "triggerReason" TEXT NOT NULL,
    "evaluationResult" BOOLEAN NOT NULL,
    "status" "AutomationExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "contextSnapshot" JSONB,
    "scriptExecutionId" TEXT,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evaluatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "evaluationTimeMs" INTEGER,
    "error" TEXT,
    "errorStack" TEXT,

    CONSTRAINT "AutomationExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationVersion" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "blocklyWorkspace" JSONB NOT NULL,
    "generatedCode" TEXT NOT NULL,
    "changedById" TEXT,
    "changeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRecommendation" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "executionId" TEXT,
    "status" "AutomationRecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "RecommendationSeverity" NOT NULL DEFAULT 'MEDIUM',
    "userAction" "RecommendationUserAction",
    "actionTakenById" TEXT,
    "actionTakenAt" TIMESTAMP(3),
    "snoozeUntil" TIMESTAMP(3),
    "dismissReason" TEXT,
    "scriptId" TEXT,
    "systemScriptId" TEXT,
    "scriptExecutionId" TEXT,
    "autoResolvedAt" TIMESTAMP(3),
    "autoResolveReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "AutomationRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SystemScript_name_key" ON "SystemScript"("name");

-- CreateIndex
CREATE INDEX "SystemScript_category_idx" ON "SystemScript"("category");

-- CreateIndex
CREATE INDEX "SystemScript_isEnabled_idx" ON "SystemScript"("isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "CustomBlock_name_key" ON "CustomBlock"("name");

-- CreateIndex
CREATE INDEX "CustomBlock_category_idx" ON "CustomBlock"("category");

-- CreateIndex
CREATE INDEX "CustomBlock_isEnabled_idx" ON "CustomBlock"("isEnabled");

-- CreateIndex
CREATE INDEX "CustomBlock_isBuiltIn_idx" ON "CustomBlock"("isBuiltIn");

-- CreateIndex
CREATE INDEX "Automation_status_isEnabled_idx" ON "Automation"("status", "isEnabled");

-- CreateIndex
CREATE INDEX "Automation_departmentId_idx" ON "Automation"("departmentId");

-- CreateIndex
CREATE INDEX "Automation_createdById_idx" ON "Automation"("createdById");

-- CreateIndex
CREATE INDEX "Automation_recommendationType_idx" ON "Automation"("recommendationType");

-- CreateIndex
CREATE INDEX "AutomationTarget_automationId_idx" ON "AutomationTarget"("automationId");

-- CreateIndex
CREATE INDEX "AutomationTarget_machineId_idx" ON "AutomationTarget"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationTarget_automationId_machineId_key" ON "AutomationTarget"("automationId", "machineId");

-- CreateIndex
CREATE INDEX "AutomationScript_automationId_idx" ON "AutomationScript"("automationId");

-- CreateIndex
CREATE INDEX "AutomationScript_scriptId_idx" ON "AutomationScript"("scriptId");

-- CreateIndex
CREATE INDEX "AutomationScript_systemScriptId_idx" ON "AutomationScript"("systemScriptId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationScript_automationId_scriptId_os_key" ON "AutomationScript"("automationId", "scriptId", "os");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationScript_automationId_systemScriptId_os_key" ON "AutomationScript"("automationId", "systemScriptId", "os");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationExecution_scriptExecutionId_key" ON "AutomationExecution"("scriptExecutionId");

-- CreateIndex
CREATE INDEX "AutomationExecution_automationId_triggeredAt_idx" ON "AutomationExecution"("automationId", "triggeredAt");

-- CreateIndex
CREATE INDEX "AutomationExecution_machineId_triggeredAt_idx" ON "AutomationExecution"("machineId", "triggeredAt");

-- CreateIndex
CREATE INDEX "AutomationExecution_status_idx" ON "AutomationExecution"("status");

-- CreateIndex
CREATE INDEX "AutomationExecution_snapshotId_idx" ON "AutomationExecution"("snapshotId");

-- CreateIndex
CREATE INDEX "AutomationVersion_automationId_idx" ON "AutomationVersion"("automationId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationVersion_automationId_version_key" ON "AutomationVersion"("automationId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRecommendation_scriptExecutionId_key" ON "AutomationRecommendation"("scriptExecutionId");

-- CreateIndex
CREATE INDEX "AutomationRecommendation_machineId_status_idx" ON "AutomationRecommendation"("machineId", "status");

-- CreateIndex
CREATE INDEX "AutomationRecommendation_status_idx" ON "AutomationRecommendation"("status");

-- CreateIndex
CREATE INDEX "AutomationRecommendation_createdAt_idx" ON "AutomationRecommendation"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRecommendation_automationId_machineId_status_key" ON "AutomationRecommendation"("automationId", "machineId", "status");

-- AddForeignKey
ALTER TABLE "SystemScript" ADD CONSTRAINT "SystemScript_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomBlock" ADD CONSTRAINT "CustomBlock_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationTarget" ADD CONSTRAINT "AutomationTarget_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationTarget" ADD CONSTRAINT "AutomationTarget_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationScript" ADD CONSTRAINT "AutomationScript_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationScript" ADD CONSTRAINT "AutomationScript_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationScript" ADD CONSTRAINT "AutomationScript_systemScriptId_fkey" FOREIGN KEY ("systemScriptId") REFERENCES "SystemScript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "VMHealthSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_scriptExecutionId_fkey" FOREIGN KEY ("scriptExecutionId") REFERENCES "ScriptExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationVersion" ADD CONSTRAINT "AutomationVersion_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationVersion" ADD CONSTRAINT "AutomationVersion_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRecommendation" ADD CONSTRAINT "AutomationRecommendation_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRecommendation" ADD CONSTRAINT "AutomationRecommendation_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRecommendation" ADD CONSTRAINT "AutomationRecommendation_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "AutomationExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRecommendation" ADD CONSTRAINT "AutomationRecommendation_actionTakenById_fkey" FOREIGN KEY ("actionTakenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRecommendation" ADD CONSTRAINT "AutomationRecommendation_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRecommendation" ADD CONSTRAINT "AutomationRecommendation_systemScriptId_fkey" FOREIGN KEY ("systemScriptId") REFERENCES "SystemScript"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRecommendation" ADD CONSTRAINT "AutomationRecommendation_scriptExecutionId_fkey" FOREIGN KEY ("scriptExecutionId") REFERENCES "ScriptExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
