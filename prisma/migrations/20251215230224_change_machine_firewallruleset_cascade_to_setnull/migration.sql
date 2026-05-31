-- DropForeignKey
ALTER TABLE "public"."Machine" DROP CONSTRAINT "Machine_firewallRuleSetId_fkey";

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_firewallRuleSetId_fkey" FOREIGN KEY ("firewallRuleSetId") REFERENCES "FirewallRuleSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
