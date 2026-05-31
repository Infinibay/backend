-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'APPROVED', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ScriptType" AS ENUM ('GENERAL', 'SYSTEM_ACTION', 'DETECTION');

-- AlterTable
ALTER TABLE "Script" ADD COLUMN     "isSystemScript" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scriptType" "ScriptType" NOT NULL DEFAULT 'GENERAL';

-- AlterTable
ALTER TABLE "VMRecommendation" ADD COLUMN     "detectionKey" TEXT;

-- CreateTable
CREATE TABLE "DetectionDefinition" (
    "id" TEXT NOT NULL,
    "detectionKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "supportedOS" "OS"[],
    "isSystemDetection" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "detectionScript" TEXT,
    "detectionThresholds" JSONB,
    "severity" TEXT NOT NULL,
    "icon" TEXT,
    "tags" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DetectionDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetectionAction" (
    "id" TEXT NOT NULL,
    "detectionDefinitionId" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "targetOS" "OS",
    "priority" INTEGER NOT NULL DEFAULT 1,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "autoExecute" BOOLEAN NOT NULL DEFAULT false,
    "parameterMapping" JSONB,
    "executionConditions" JSONB,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DetectionAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetectionDataSchema" (
    "id" TEXT NOT NULL,
    "detectionDefinitionId" TEXT NOT NULL,
    "dataSchema" JSONB NOT NULL,
    "exampleData" JSONB,
    "contextVariables" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DetectionDataSchema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentDetectionConfig" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "detectionDefinitionId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "thresholdOverrides" JSONB,
    "notifyOnDetection" BOOLEAN NOT NULL DEFAULT false,
    "notificationEmails" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepartmentDetectionConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentDetectionAction" (
    "id" TEXT NOT NULL,
    "departmentDetectionConfigId" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "targetOS" "OS",
    "priority" INTEGER NOT NULL DEFAULT 1,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "autoExecute" BOOLEAN NOT NULL DEFAULT false,
    "parameterMapping" JSONB,
    "executionConditions" JSONB,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepartmentDetectionAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationAction" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "scriptParameters" JSONB NOT NULL,
    "executionId" TEXT,
    "executedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecommendationAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DetectionDefinition_detectionKey_key" ON "DetectionDefinition"("detectionKey");

-- CreateIndex
CREATE INDEX "DetectionDefinition_detectionKey_idx" ON "DetectionDefinition"("detectionKey");

-- CreateIndex
CREATE INDEX "DetectionDefinition_isSystemDetection_isActive_idx" ON "DetectionDefinition"("isSystemDetection", "isActive");

-- CreateIndex
CREATE INDEX "DetectionDefinition_category_idx" ON "DetectionDefinition"("category");

-- CreateIndex
CREATE INDEX "DetectionAction_detectionDefinitionId_priority_idx" ON "DetectionAction"("detectionDefinitionId", "priority");

-- CreateIndex
CREATE INDEX "DetectionAction_targetOS_idx" ON "DetectionAction"("targetOS");

-- CreateIndex
CREATE UNIQUE INDEX "DetectionDataSchema_detectionDefinitionId_key" ON "DetectionDataSchema"("detectionDefinitionId");

-- CreateIndex
CREATE INDEX "DepartmentDetectionConfig_departmentId_idx" ON "DepartmentDetectionConfig"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentDetectionConfig_departmentId_detectionDefinitionI_key" ON "DepartmentDetectionConfig"("departmentId", "detectionDefinitionId");

-- CreateIndex
CREATE INDEX "DepartmentDetectionAction_departmentDetectionConfigId_prior_idx" ON "DepartmentDetectionAction"("departmentDetectionConfigId", "priority");

-- CreateIndex
CREATE INDEX "RecommendationAction_recommendationId_idx" ON "RecommendationAction"("recommendationId");

-- CreateIndex
CREATE INDEX "RecommendationAction_status_idx" ON "RecommendationAction"("status");

-- CreateIndex
CREATE INDEX "RecommendationAction_scriptId_idx" ON "RecommendationAction"("scriptId");

-- CreateIndex
CREATE INDEX "VMRecommendation_detectionKey_idx" ON "VMRecommendation"("detectionKey");

-- AddForeignKey
ALTER TABLE "DetectionDefinition" ADD CONSTRAINT "DetectionDefinition_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectionAction" ADD CONSTRAINT "DetectionAction_detectionDefinitionId_fkey" FOREIGN KEY ("detectionDefinitionId") REFERENCES "DetectionDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectionAction" ADD CONSTRAINT "DetectionAction_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectionDataSchema" ADD CONSTRAINT "DetectionDataSchema_detectionDefinitionId_fkey" FOREIGN KEY ("detectionDefinitionId") REFERENCES "DetectionDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentDetectionConfig" ADD CONSTRAINT "DepartmentDetectionConfig_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentDetectionConfig" ADD CONSTRAINT "DepartmentDetectionConfig_detectionDefinitionId_fkey" FOREIGN KEY ("detectionDefinitionId") REFERENCES "DetectionDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentDetectionAction" ADD CONSTRAINT "DepartmentDetectionAction_departmentDetectionConfigId_fkey" FOREIGN KEY ("departmentDetectionConfigId") REFERENCES "DepartmentDetectionConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentDetectionAction" ADD CONSTRAINT "DepartmentDetectionAction_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationAction" ADD CONSTRAINT "RecommendationAction_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "VMRecommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationAction" ADD CONSTRAINT "RecommendationAction_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationAction" ADD CONSTRAINT "RecommendationAction_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ScriptExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
