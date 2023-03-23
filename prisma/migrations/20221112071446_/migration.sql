/*
  Warnings:

  - You are about to drop the column `token` on the `VirtualMachine` table. All the data in the column will be lost.
  - Added the required column `token` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "token" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "VirtualMachine" DROP COLUMN "token";
