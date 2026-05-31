-- DropIndex
DROP INDEX IF EXISTS "FirewallRuleSet_entityType_entityId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "FirewallRuleSet_entityType_entityId_key" ON "FirewallRuleSet"("entityType", "entityId");
