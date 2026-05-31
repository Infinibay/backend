-- CreateEnum
CREATE TYPE "AgentEventSeverity" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "AgentEvent" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "severity" "AgentEventSeverity" NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "executionId" TEXT,
    "context" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentEvent_machineId_createdAt_idx" ON "AgentEvent"("machineId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentEvent_executionId_idx" ON "AgentEvent"("executionId");

-- AddForeignKey
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ScriptExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
