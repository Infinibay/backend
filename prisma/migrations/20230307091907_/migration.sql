/*
  Warnings:

  - You are about to drop the column ` vmId` on the `Notification` table. All the data in the column will be lost.
  - You are about to drop the column `First_Name` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `Last_Name` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `User_Image` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `User_Type` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `guId ` on the `VirtualMachine` table. All the data in the column will be lost.
  - You are about to drop the column `vmImage ` on the `VirtualMachine` table. All the data in the column will be lost.
  - You are about to drop the `IOS` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[userImage]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[guId]` on the table `VirtualMachine` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[vmImage]` on the table `VirtualMachine` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `firstName` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lastName` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userType` to the `User` table without a default value. This is not possible if the table is not empty.
  - The required column `guId` was added to the `VirtualMachine` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- DropForeignKey
ALTER TABLE "IOS" DROP CONSTRAINT "IOS_userId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_ vmId_fkey";

-- DropIndex
DROP INDEX "User_User_Image_key";

-- DropIndex
DROP INDEX "VirtualMachine_guId _key";

-- DropIndex
DROP INDEX "VirtualMachine_vmImage _key";

-- AlterTable
ALTER TABLE "Notification" DROP COLUMN " vmId",
ADD COLUMN     "vmId" TEXT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "First_Name",
DROP COLUMN "Last_Name",
DROP COLUMN "User_Image",
DROP COLUMN "User_Type",
ADD COLUMN     "firstName" TEXT NOT NULL,
ADD COLUMN     "lastName" TEXT NOT NULL,
ADD COLUMN     "userImage" TEXT,
ADD COLUMN     "userType" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "VirtualMachine" DROP COLUMN "guId ",
DROP COLUMN "vmImage ",
ADD COLUMN     "guId" TEXT NOT NULL,
ADD COLUMN     "vmImage" TEXT;

-- DropTable
DROP TABLE "IOS";

-- CreateTable
CREATE TABLE "ISO" (
    "id" TEXT NOT NULL,
    "Name" TEXT NOT NULL,
    "Type" TEXT NOT NULL,
    "Size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,

    CONSTRAINT "ISO_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_userImage_key" ON "User"("userImage");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualMachine_guId_key" ON "VirtualMachine"("guId");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualMachine_vmImage_key" ON "VirtualMachine"("vmImage");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "VirtualMachine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ISO" ADD CONSTRAINT "ISO_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
