-- DropForeignKey
ALTER TABLE "public"."Machine" DROP CONSTRAINT "Machine_firewallRuleSetId_fkey";

-- DropForeignKey
ALTER TABLE "public"."MachineApplication" DROP CONSTRAINT "MachineApplication_machineId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PendingCommand" DROP CONSTRAINT "PendingCommand_machineId_fkey";

-- AlterTable
ALTER TABLE "MachineConfiguration" ADD COLUMN     "cpuPinningStrategy" TEXT DEFAULT 'basic',
ADD COLUMN     "enableNumaCtlPinning" BOOLEAN DEFAULT false;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_firewallRuleSetId_fkey" FOREIGN KEY ("firewallRuleSetId") REFERENCES "FirewallRuleSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineApplication" ADD CONSTRAINT "MachineApplication_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingCommand" ADD CONSTRAINT "PendingCommand_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
