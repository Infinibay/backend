/*
  Warnings:

  - You are about to drop the column `diskId` on the `VirtualMachine` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "VirtualMachine" DROP CONSTRAINT "VirtualMachine_diskId_fkey";

-- AlterTable
ALTER TABLE "VirtualMachine" DROP COLUMN "diskId";
