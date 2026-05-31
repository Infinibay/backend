-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "bridgeName" TEXT,
ADD COLUMN     "dhcpRangeEnd" TEXT,
ADD COLUMN     "dhcpRangeStart" TEXT,
ADD COLUMN     "dnsmasqPid" INTEGER,
ADD COLUMN     "gatewayIP" TEXT;

-- CreateIndex
CREATE INDEX "Department_bridgeName_idx" ON "Department"("bridgeName");
