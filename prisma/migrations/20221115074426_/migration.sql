/*
  Warnings:

  - A unique constraint covering the columns `[User_Image]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[VM_Image]` on the table `VirtualMachine` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "User_Image" TEXT NOT NULL DEFAULT 'null';

-- AlterTable
ALTER TABLE "VirtualMachine" ADD COLUMN     "VM_Image" TEXT NOT NULL DEFAULT 'null';

-- CreateIndex
CREATE UNIQUE INDEX "User_User_Image_key" ON "User"("User_Image");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualMachine_VM_Image_key" ON "VirtualMachine"("VM_Image");
