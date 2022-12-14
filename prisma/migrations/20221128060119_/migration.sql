/*
  Warnings:

  - Added the required column `Size` to the `IOS` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "IOS" ADD COLUMN     "Size" INTEGER NOT NULL;
