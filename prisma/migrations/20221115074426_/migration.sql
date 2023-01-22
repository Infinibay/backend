/*
  Warnings:

  - A unique constraint covering the columns `[User_Image]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[vmImage ]` on the table `VirtualMachine` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "User_Image" TEXT NOT NULL DEFAULT 'null';

-- AlterTable
ALTER TABLE "VirtualMachine" ADD COLUMN     "vmImage " TEXT NOT NULL DEFAULT 'null';

-- CreateIndex
CREATE UNIQUE INDEX "User_User_Image_key" ON "User"("User_Image");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualMachine_vmImage _key" ON "VirtualMachine"("vmImage ");
