/*
  Warnings:

  - You are about to drop the column `userId` on the `Disk` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Disk" DROP CONSTRAINT "Disk_userId_fkey";

-- AlterTable
ALTER TABLE "Disk" DROP COLUMN "userId";
