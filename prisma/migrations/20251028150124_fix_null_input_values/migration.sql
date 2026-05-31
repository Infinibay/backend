-- CreateEnum
CREATE TYPE "ScriptStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Script" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "status" "ScriptStatus" NOT NULL DEFAULT 'APPROVED';

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Fix null inputValues in ScriptExecution table (convert to empty JSON object)
UPDATE "ScriptExecution"
SET "inputValues" = '{}'::jsonb
WHERE "inputValues" IS NULL;
