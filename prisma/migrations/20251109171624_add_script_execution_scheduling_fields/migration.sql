-- AlterTable
ALTER TABLE "ScriptExecution" ADD COLUMN     "executionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastExecutedAt" TIMESTAMP(3),
ADD COLUMN     "maxExecutions" INTEGER,
ADD COLUMN     "repeatIntervalMinutes" INTEGER,
ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ScriptExecution_machineId_status_scheduledFor_idx" ON "ScriptExecution"("machineId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "ScriptExecution_status_scheduledFor_idx" ON "ScriptExecution"("status", "scheduledFor");
