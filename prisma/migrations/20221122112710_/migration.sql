-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_ vmId_fkey";

-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN " vmId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_ vmId_fkey" FOREIGN KEY (" vmId") REFERENCES "VirtualMachine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
