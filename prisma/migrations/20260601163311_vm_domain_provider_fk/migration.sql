-- CreateIndex
CREATE INDEX "MachineConfiguration_domainIdentityProviderId_idx" ON "MachineConfiguration"("domainIdentityProviderId");

-- AddForeignKey
ALTER TABLE "MachineConfiguration" ADD CONSTRAINT "MachineConfiguration_domainIdentityProviderId_fkey" FOREIGN KEY ("domainIdentityProviderId") REFERENCES "IdentityProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
