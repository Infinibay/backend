-- CreateEnum
CREATE TYPE "BackupType" AS ENUM ('FULL', 'INCREMENTAL', 'SNAPSHOT');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BackupCompression" AS ENUM ('NONE', 'QCOW2', 'GZIP');

-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "backupId" TEXT NOT NULL,
    "vmId" TEXT NOT NULL,
    "type" "BackupType" NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'PENDING',
    "diskPaths" JSONB,
    "totalSize" BIGINT NOT NULL DEFAULT 0,
    "totalOriginalSize" BIGINT NOT NULL DEFAULT 0,
    "compression" "BackupCompression" NOT NULL DEFAULT 'NONE',
    "destinationDir" TEXT,
    "parentBackupId" TEXT,
    "errorMessage" TEXT,
    "description" TEXT,
    "tags" JSONB,
    "durationMs" INTEGER,
    "scheduleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupSchedule" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "vmId" TEXT NOT NULL,
    "type" "BackupType" NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "retentionCount" INTEGER NOT NULL DEFAULT 7,
    "destinationDir" TEXT,
    "compression" "BackupCompression" NOT NULL DEFAULT 'NONE',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastBackupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Backup_backupId_key" ON "Backup"("backupId");

-- CreateIndex
CREATE INDEX "Backup_vmId_idx" ON "Backup"("vmId");

-- CreateIndex
CREATE INDEX "Backup_scheduleId_idx" ON "Backup"("scheduleId");

-- CreateIndex
CREATE INDEX "Backup_status_idx" ON "Backup"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BackupSchedule_scheduleId_key" ON "BackupSchedule"("scheduleId");

-- CreateIndex
CREATE INDEX "BackupSchedule_vmId_idx" ON "BackupSchedule"("vmId");

-- CreateIndex
CREATE INDEX "BackupSchedule_enabled_idx" ON "BackupSchedule"("enabled");

-- AddForeignKey
ALTER TABLE "Backup" ADD CONSTRAINT "Backup_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backup" ADD CONSTRAINT "Backup_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "BackupSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupSchedule" ADD CONSTRAINT "BackupSchedule_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
