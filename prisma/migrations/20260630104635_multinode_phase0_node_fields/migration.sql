-- Multi-node Phase 0: Node onboarding/identity columns, MigrationJob, Machine.migrationJobId.
-- Structural only. Data backfill (role/status/lastHeartbeat on the local node + adopting
-- unassigned VMs onto the master) happens at runtime in LocalNodeRegistrationService.registerLocalNode.

-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "address" TEXT,
ADD COLUMN     "agentPort" INTEGER NOT NULL DEFAULT 9443,
ADD COLUMN     "agentVersion" TEXT,
ADD COLUMN     "certPem" TEXT,
ADD COLUMN     "fingerprint" TEXT,
ADD COLUMN     "joinCodeHash" TEXT,
ADD COLUMN     "joinNonce" TEXT,
ADD COLUMN     "labels" JSONB,
ADD COLUMN     "lastHeartbeat" TIMESTAMP(3),
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'compute',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending';

-- AlterTable
ALTER TABLE "Machine" ADD COLUMN     "migrationJobId" TEXT;

-- CreateTable
CREATE TABLE "MigrationJob" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "sourceNodeId" TEXT,
    "targetNodeId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "bytesTotal" BIGINT,
    "bytesDone" BIGINT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MigrationJob_machineId_idx" ON "MigrationJob"("machineId");

-- CreateIndex
CREATE INDEX "MigrationJob_phase_idx" ON "MigrationJob"("phase");

-- CreateIndex
CREATE UNIQUE INDEX "Node_fingerprint_key" ON "Node"("fingerprint");

-- CreateIndex
CREATE INDEX "Node_status_idx" ON "Node"("status");

