-- AlterTable
-- Note: Machine.version was added to schema for optimistic locking but was missing from migrations.
-- This migration catches up the database to include this field alongside the QEMU config fields.
ALTER TABLE "Machine" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
-- Add QEMU configuration fields for complete VM control:
-- - Network: bridge, networkModel, networkQueues
-- - Machine: machineType, cpuModel
-- - Storage: diskBus, diskCacheMode, ioThreads
-- - GPU: gpuRomFile, gpuAudioBus
-- - Performance: memoryBalloon, hugepages
-- - Advanced: numaConfig, cpuPinning
-- - UEFI: uefiFirmware, secureboot
-- - Process management: qmpSocketPath, qemuPid, tapDeviceName
ALTER TABLE "MachineConfiguration" ADD COLUMN     "bridge" TEXT DEFAULT 'virbr0',
ADD COLUMN     "cpuModel" TEXT DEFAULT 'host',
ADD COLUMN     "cpuPinning" JSONB,
ADD COLUMN     "diskBus" TEXT DEFAULT 'virtio',
ADD COLUMN     "diskCacheMode" TEXT DEFAULT 'writeback',
ADD COLUMN     "gpuAudioBus" TEXT,
ADD COLUMN     "gpuRomFile" TEXT,
ADD COLUMN     "hugepages" BOOLEAN DEFAULT false,
ADD COLUMN     "ioThreads" BOOLEAN DEFAULT false,
ADD COLUMN     "machineType" TEXT DEFAULT 'q35',
ADD COLUMN     "memoryBalloon" BOOLEAN DEFAULT false,
ADD COLUMN     "networkModel" TEXT DEFAULT 'virtio-net-pci',
ADD COLUMN     "networkQueues" INTEGER DEFAULT 1,
ADD COLUMN     "numaConfig" JSONB,
ADD COLUMN     "qemuPid" INTEGER,
ADD COLUMN     "qmpSocketPath" TEXT,
ADD COLUMN     "secureboot" BOOLEAN DEFAULT false,
ADD COLUMN     "tapDeviceName" TEXT,
ADD COLUMN     "uefiFirmware" TEXT;
