-- AlterTable
ALTER TABLE "VirtualMachine" ALTER COLUMN "vmImage " DROP NOT NULL,
ALTER COLUMN "vmImage " DROP DEFAULT;
