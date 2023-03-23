/*
  Warnings:

  - You are about to drop the column `storageId` on the `VirtualMachine` table. All the data in the column will be lost.
  - You are about to drop the `Disk` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Storage` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Disk" DROP CONSTRAINT "Disk_storageId_fkey";

-- DropForeignKey
ALTER TABLE "Disk" DROP CONSTRAINT "Disk_userId_fkey";

-- DropForeignKey
ALTER TABLE "Storage" DROP CONSTRAINT "Storage_userId_fkey";

-- DropForeignKey
ALTER TABLE "VirtualMachine" DROP CONSTRAINT "VirtualMachine_storageId_fkey";

-- AlterTable
ALTER TABLE "VirtualMachine" DROP COLUMN "storageId";

-- DropTable
DROP TABLE "Disk";

-- DropTable
DROP TABLE "Storage";
