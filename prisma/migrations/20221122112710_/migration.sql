-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_vm_id_fkey";

-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "vm_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_vm_id_fkey" FOREIGN KEY ("vm_id") REFERENCES "VirtualMachine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
