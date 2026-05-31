-- AlterEnum
ALTER TYPE "HealthCheckType" ADD VALUE 'LINUX_UPDATES';

-- AlterTable
ALTER TABLE "VMHealthSnapshot" ADD COLUMN     "linuxUpdateInfo" JSONB;
