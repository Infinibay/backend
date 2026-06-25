-- Wall-clock anchor for the unattended OS install, used by the stuck-install
-- detector to fail a hung install past getInstallationTimeout(os).
ALTER TABLE "MachineConfiguration" ADD COLUMN     "installStartedAt" TIMESTAMP(3);
