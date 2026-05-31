-- DropIndex
DROP INDEX "ScriptExecution_machineId_createdAt_idx";

-- AlterTable
ALTER TABLE "ScriptExecution" ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "ScriptExecution_machineId_order_idx" ON "ScriptExecution"("machineId", "order");
