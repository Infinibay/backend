/*
  Warnings:

  - You are about to drop the column `Type` on the `User` table. All the data in the column will be lost.
  - Added the required column `User_Type` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "Type",
ADD COLUMN     "User_Type" TEXT NOT NULL;
