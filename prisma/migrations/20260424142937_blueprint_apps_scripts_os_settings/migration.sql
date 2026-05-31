-- AlterTable
ALTER TABLE "MachineTemplate" ADD COLUMN     "powerPlan" TEXT,
ADD COLUMN     "wallpaperUrl" TEXT;

-- CreateTable
CREATE TABLE "MachineTemplateApplication" (
    "templateId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "parameters" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineTemplateApplication_pkey" PRIMARY KEY ("templateId","applicationId")
);

-- CreateTable
CREATE TABLE "MachineTemplateScript" (
    "templateId" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "inputValues" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineTemplateScript_pkey" PRIMARY KEY ("templateId","scriptId")
);

-- CreateIndex
CREATE INDEX "MachineTemplateApplication_templateId_idx" ON "MachineTemplateApplication"("templateId");

-- CreateIndex
CREATE INDEX "MachineTemplateApplication_applicationId_idx" ON "MachineTemplateApplication"("applicationId");

-- CreateIndex
CREATE INDEX "MachineTemplateScript_templateId_idx" ON "MachineTemplateScript"("templateId");

-- CreateIndex
CREATE INDEX "MachineTemplateScript_scriptId_idx" ON "MachineTemplateScript"("scriptId");

-- AddForeignKey
ALTER TABLE "MachineTemplateApplication" ADD CONSTRAINT "MachineTemplateApplication_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MachineTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineTemplateApplication" ADD CONSTRAINT "MachineTemplateApplication_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineTemplateScript" ADD CONSTRAINT "MachineTemplateScript_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MachineTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineTemplateScript" ADD CONSTRAINT "MachineTemplateScript_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE CASCADE ON UPDATE CASCADE;
