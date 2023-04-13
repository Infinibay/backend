-- AlterTable
ALTER TABLE "VirtualMachine" ADD COLUMN     "storageId" TEXT;

-- CreateTable
CREATE TABLE "Storage" (
    "id" TEXT NOT NULL,
    "storageName" TEXT NOT NULL,
    "storageType" TEXT NOT NULL,
    "storageSize" INTEGER NOT NULL,
    "userId" TEXT,

    CONSTRAINT "Storage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Disk" (
    "id" TEXT NOT NULL,
    "diskName" TEXT NOT NULL,
    "diskSize" INTEGER NOT NULL,
    "storageId" TEXT,
    "userId" TEXT,

    CONSTRAINT "Disk_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "VirtualMachine" ADD CONSTRAINT "VirtualMachine_storageId_fkey" FOREIGN KEY ("storageId") REFERENCES "Storage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Storage" ADD CONSTRAINT "Storage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disk" ADD CONSTRAINT "Disk_storageId_fkey" FOREIGN KEY ("storageId") REFERENCES "Storage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disk" ADD CONSTRAINT "Disk_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
