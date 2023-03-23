-- AlterTable
ALTER TABLE "VirtualMachine" ADD COLUMN     "storageId" TEXT DEFAULT '',
ALTER COLUMN "diskId" SET DEFAULT '';

-- AddForeignKey
ALTER TABLE "VirtualMachine" ADD CONSTRAINT "VirtualMachine_storageId_fkey" FOREIGN KEY ("storageId") REFERENCES "Storage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
