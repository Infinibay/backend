/*
  Warnings:

  - Added the required column `token` to the `VirtualMachine` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "VirtualMachine" ADD COLUMN     "token" TEXT NOT NULL;
