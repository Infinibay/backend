/*
  Warnings:

  - A unique constraint covering the columns `[activeResolutionId]` on the table `VMRecommendation` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ResolutionStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'REQUIRES_REBOOT', 'CANCELLED');

-- AlterTable
ALTER TABLE "VMRecommendation" ADD COLUMN     "activeResolutionId" TEXT;

-- CreateTable
CREATE TABLE "RecommendationResolution" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "status" "ResolutionStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progressMessage" TEXT,
    "params" JSONB,
    "result" JSONB,
    "error" TEXT,
    "triggeredByUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecommendationResolution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecommendationResolution_recommendationId_idx" ON "RecommendationResolution"("recommendationId");

-- CreateIndex
CREATE INDEX "RecommendationResolution_machineId_status_idx" ON "RecommendationResolution"("machineId", "status");

-- CreateIndex
CREATE INDEX "RecommendationResolution_status_createdAt_idx" ON "RecommendationResolution"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VMRecommendation_activeResolutionId_key" ON "VMRecommendation"("activeResolutionId");

-- AddForeignKey
ALTER TABLE "VMRecommendation" ADD CONSTRAINT "VMRecommendation_activeResolutionId_fkey" FOREIGN KEY ("activeResolutionId") REFERENCES "RecommendationResolution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationResolution" ADD CONSTRAINT "RecommendationResolution_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "VMRecommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationResolution" ADD CONSTRAINT "RecommendationResolution_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
