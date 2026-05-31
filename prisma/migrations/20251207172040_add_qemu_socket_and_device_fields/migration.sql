-- AlterTable
ALTER TABLE "MachineConfiguration" ADD COLUMN     "enableAudio" BOOLEAN DEFAULT false,
ADD COLUMN     "enableUsbTablet" BOOLEAN DEFAULT true,
ADD COLUMN     "guestAgentSocketPath" TEXT,
ADD COLUMN     "infiniServiceSocketPath" TEXT,
ADD COLUMN     "tpmSocketPath" TEXT,
ADD COLUMN     "virtioDriversIso" TEXT;
