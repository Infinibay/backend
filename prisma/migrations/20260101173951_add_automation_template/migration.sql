-- CreateTable
CREATE TABLE "AutomationTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "recommendationType" "RecommendationType",
    "blocklyWorkspace" JSONB NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutomationTemplate_name_key" ON "AutomationTemplate"("name");

-- CreateIndex
CREATE INDEX "AutomationTemplate_category_idx" ON "AutomationTemplate"("category");

-- CreateIndex
CREATE INDEX "AutomationTemplate_isEnabled_idx" ON "AutomationTemplate"("isEnabled");
