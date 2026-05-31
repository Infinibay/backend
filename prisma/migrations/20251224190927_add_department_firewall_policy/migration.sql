-- CreateEnum
CREATE TYPE "FirewallPolicy" AS ENUM ('ALLOW_ALL', 'BLOCK_ALL');

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "firewallCustomRules" JSONB,
ADD COLUMN     "firewallDefaultConfig" TEXT DEFAULT 'allow_outbound',
ADD COLUMN     "firewallPolicy" "FirewallPolicy" NOT NULL DEFAULT 'BLOCK_ALL';
