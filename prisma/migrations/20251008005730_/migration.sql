/*
  Warnings:

  - You are about to drop the column `firewallTemplates` on the `Machine` table. All the data in the column will be lost.
  - You are about to drop the `DepartmentConfiguration` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DepartmentNWFilter` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DepartmentServiceConfig` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `FWRule` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `FilterReference` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `GlobalServiceConfig` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `NWFilter` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `VMNWFilter` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `VMServiceConfig` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `VmPort` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[firewallRuleSetId]` on the table `Department` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[firewallRuleSetId]` on the table `Machine` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "RuleSetType" AS ENUM ('DEPARTMENT', 'VM');

-- CreateEnum
CREATE TYPE "RuleAction" AS ENUM ('ACCEPT', 'DROP', 'REJECT');

-- CreateEnum
CREATE TYPE "RuleDirection" AS ENUM ('IN', 'OUT', 'INOUT');

-- DropForeignKey
ALTER TABLE "public"."DepartmentConfiguration" DROP CONSTRAINT "DepartmentConfiguration_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."DepartmentNWFilter" DROP CONSTRAINT "DepartmentNWFilter_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."DepartmentNWFilter" DROP CONSTRAINT "DepartmentNWFilter_nwFilterId_fkey";

-- DropForeignKey
ALTER TABLE "public"."DepartmentServiceConfig" DROP CONSTRAINT "DepartmentServiceConfig_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."FWRule" DROP CONSTRAINT "FWRule_nwFilterId_fkey";

-- DropForeignKey
ALTER TABLE "public"."FilterReference" DROP CONSTRAINT "FilterReference_sourceFilterId_fkey";

-- DropForeignKey
ALTER TABLE "public"."FilterReference" DROP CONSTRAINT "FilterReference_targetFilterId_fkey";

-- DropForeignKey
ALTER TABLE "public"."VMNWFilter" DROP CONSTRAINT "VMNWFilter_nwFilterId_fkey";

-- DropForeignKey
ALTER TABLE "public"."VMNWFilter" DROP CONSTRAINT "VMNWFilter_vmId_fkey";

-- DropForeignKey
ALTER TABLE "public"."VMServiceConfig" DROP CONSTRAINT "VMServiceConfig_vmId_fkey";

-- DropForeignKey
ALTER TABLE "public"."VmPort" DROP CONSTRAINT "VmPort_vmId_fkey";

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "firewallRuleSetId" TEXT;

-- AlterTable
ALTER TABLE "Machine" DROP COLUMN "firewallTemplates",
ADD COLUMN     "firewallRuleSetId" TEXT;

-- DropTable
DROP TABLE "public"."DepartmentConfiguration";

-- DropTable
DROP TABLE "public"."DepartmentNWFilter";

-- DropTable
DROP TABLE "public"."DepartmentServiceConfig";

-- DropTable
DROP TABLE "public"."FWRule";

-- DropTable
DROP TABLE "public"."FilterReference";

-- DropTable
DROP TABLE "public"."GlobalServiceConfig";

-- DropTable
DROP TABLE "public"."NWFilter";

-- DropTable
DROP TABLE "public"."VMNWFilter";

-- DropTable
DROP TABLE "public"."VMServiceConfig";

-- DropTable
DROP TABLE "public"."VmPort";

-- CreateTable
CREATE TABLE "FirewallRuleSet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "internalName" TEXT NOT NULL,
    "entityType" "RuleSetType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 500,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "libvirtUuid" TEXT,
    "xmlContent" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FirewallRuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FirewallRule" (
    "id" TEXT NOT NULL,
    "ruleSetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "action" "RuleAction" NOT NULL DEFAULT 'ACCEPT',
    "direction" "RuleDirection" NOT NULL DEFAULT 'INOUT',
    "priority" INTEGER NOT NULL DEFAULT 500,
    "protocol" TEXT NOT NULL DEFAULT 'all',
    "srcPortStart" INTEGER,
    "srcPortEnd" INTEGER,
    "dstPortStart" INTEGER,
    "dstPortEnd" INTEGER,
    "srcIpAddr" TEXT,
    "srcIpMask" TEXT,
    "dstIpAddr" TEXT,
    "dstIpMask" TEXT,
    "connectionState" JSONB,
    "overridesDept" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FirewallRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FirewallRuleSet_internalName_key" ON "FirewallRuleSet"("internalName");

-- CreateIndex
CREATE UNIQUE INDEX "FirewallRuleSet_libvirtUuid_key" ON "FirewallRuleSet"("libvirtUuid");

-- CreateIndex
CREATE INDEX "FirewallRuleSet_entityType_entityId_idx" ON "FirewallRuleSet"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "FirewallRuleSet_isActive_idx" ON "FirewallRuleSet"("isActive");

-- CreateIndex
CREATE INDEX "FirewallRule_ruleSetId_priority_idx" ON "FirewallRule"("ruleSetId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "Department_firewallRuleSetId_key" ON "Department"("firewallRuleSetId");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_firewallRuleSetId_key" ON "Machine"("firewallRuleSetId");

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_firewallRuleSetId_fkey" FOREIGN KEY ("firewallRuleSetId") REFERENCES "FirewallRuleSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_firewallRuleSetId_fkey" FOREIGN KEY ("firewallRuleSetId") REFERENCES "FirewallRuleSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirewallRule" ADD CONSTRAINT "FirewallRule_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "FirewallRuleSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
