/*
  Warnings:

  - You are about to drop the column `Name` on the `ISO` table. All the data in the column will be lost.
  - You are about to drop the column `Size` on the `ISO` table. All the data in the column will be lost.
  - You are about to drop the column `Type` on the `ISO` table. All the data in the column will be lost.
  - You are about to drop the column `Message` on the `Notification` table. All the data in the column will be lost.
  - You are about to drop the column `Readed` on the `Notification` table. All the data in the column will be lost.
  - You are about to drop the column `Deleted` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `Email` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `Password` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `Config` on the `VirtualMachine` table. All the data in the column will be lost.
  - You are about to drop the column `Description` on the `VirtualMachine` table. All the data in the column will be lost.
  - You are about to drop the column `Status` on the `VirtualMachine` table. All the data in the column will be lost.
  - You are about to drop the column `Title` on the `VirtualMachine` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[eMail]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `name` to the `ISO` table without a default value. This is not possible if the table is not empty.
  - Added the required column `size` to the `ISO` table without a default value. This is not possible if the table is not empty.
  - Added the required column `type` to the `ISO` table without a default value. This is not possible if the table is not empty.
  - Added the required column `readed` to the `Notification` table without a default value. This is not possible if the table is not empty.
  - Added the required column `deleted` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `eMail` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `password` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `config` to the `VirtualMachine` table without a default value. This is not possible if the table is not empty.
  - Added the required column `description` to the `VirtualMachine` table without a default value. This is not possible if the table is not empty.
  - Added the required column `status` to the `VirtualMachine` table without a default value. This is not possible if the table is not empty.
  - Added the required column `title` to the `VirtualMachine` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "User_Email_key";

-- AlterTable
ALTER TABLE "ISO" DROP COLUMN "Name",
DROP COLUMN "Size",
DROP COLUMN "Type",
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "size" INTEGER NOT NULL,
ADD COLUMN     "type" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Notification" DROP COLUMN "Message",
DROP COLUMN "Readed",
ADD COLUMN     "message" TEXT,
ADD COLUMN     "readed" BOOLEAN NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "Deleted",
DROP COLUMN "Email",
DROP COLUMN "Password",
ADD COLUMN     "deleted" BOOLEAN NOT NULL,
ADD COLUMN     "eMail" TEXT NOT NULL,
ADD COLUMN     "password" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "VirtualMachine" DROP COLUMN "Config",
DROP COLUMN "Description",
DROP COLUMN "Status",
DROP COLUMN "Title",
ADD COLUMN     "config" JSONB NOT NULL,
ADD COLUMN     "description" TEXT NOT NULL,
ADD COLUMN     "status" BOOLEAN NOT NULL,
ADD COLUMN     "title" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_eMail_key" ON "User"("eMail");
