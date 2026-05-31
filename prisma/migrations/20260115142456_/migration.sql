/*
  Warnings:

  - The values [PENDING_APPROVAL,APPROVED,REJECTED] on the enum `AutomationStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `approvedAt` on the `Automation` table. All the data in the column will be lost.
  - You are about to drop the column `approvedById` on the `Automation` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "AutomationStatus_new" AS ENUM ('DRAFT', 'ARCHIVED');
ALTER TABLE "public"."Automation" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Automation" ALTER COLUMN "status" TYPE "AutomationStatus_new" USING ("status"::text::"AutomationStatus_new");
ALTER TYPE "AutomationStatus" RENAME TO "AutomationStatus_old";
ALTER TYPE "AutomationStatus_new" RENAME TO "AutomationStatus";
DROP TYPE "public"."AutomationStatus_old";
ALTER TABLE "Automation" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- DropForeignKey
ALTER TABLE "public"."Automation" DROP CONSTRAINT "Automation_approvedById_fkey";

-- AlterTable
ALTER TABLE "Automation" DROP COLUMN "approvedAt",
DROP COLUMN "approvedById";
