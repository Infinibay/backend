-- AlterTable
ALTER TABLE "MachineConfiguration" ADD COLUMN     "domainIdentityProviderId" TEXT,
ADD COLUMN     "domainJoinError" TEXT,
ADD COLUMN     "domainJoinStatus" TEXT,
ADD COLUMN     "domainJoinedAt" TIMESTAMP(3),
ADD COLUMN     "domainName" TEXT;
