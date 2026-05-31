-- CreateEnum
CREATE TYPE "OS" AS ENUM ('WINDOWS', 'LINUX');

-- CreateEnum
CREATE TYPE "ShellType" AS ENUM ('POWERSHELL', 'CMD', 'BASH', 'SH');

-- CreateEnum
CREATE TYPE "ExecutionType" AS ENUM ('FIRST_BOOT', 'ON_DEMAND', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScriptAuditAction" AS ENUM ('CREATED', 'EDITED', 'APPROVED', 'REJECTED', 'EXECUTED', 'DELETED');

-- CreateTable
CREATE TABLE "Script" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fileName" TEXT NOT NULL,
    "category" TEXT,
    "tags" TEXT[],
    "os" "OS"[],
    "shell" "ShellType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Script_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentScript" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT NOT NULL,

    CONSTRAINT "DepartmentScript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScriptExecution" (
    "id" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "executionType" "ExecutionType" NOT NULL,
    "triggeredById" TEXT,
    "inputValues" JSONB NOT NULL,
    "status" "ExecutionStatus" NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "exitCode" INTEGER,
    "stdout" TEXT,
    "stderr" TEXT,
    "error" TEXT,
    "executedAs" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScriptExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScriptAuditLog" (
    "id" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "userId" TEXT,
    "action" "ScriptAuditAction" NOT NULL,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScriptAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Script_fileName_key" ON "Script"("fileName");

-- CreateIndex
CREATE INDEX "Script_fileName_idx" ON "Script"("fileName");

-- CreateIndex
CREATE INDEX "Script_category_idx" ON "Script"("category");

-- CreateIndex
CREATE INDEX "Script_createdById_idx" ON "Script"("createdById");

-- CreateIndex
CREATE INDEX "DepartmentScript_departmentId_idx" ON "DepartmentScript"("departmentId");

-- CreateIndex
CREATE INDEX "DepartmentScript_scriptId_idx" ON "DepartmentScript"("scriptId");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentScript_departmentId_scriptId_key" ON "DepartmentScript"("departmentId", "scriptId");

-- CreateIndex
CREATE INDEX "ScriptExecution_machineId_createdAt_idx" ON "ScriptExecution"("machineId", "createdAt");

-- CreateIndex
CREATE INDEX "ScriptExecution_scriptId_createdAt_idx" ON "ScriptExecution"("scriptId", "createdAt");

-- CreateIndex
CREATE INDEX "ScriptExecution_status_idx" ON "ScriptExecution"("status");

-- CreateIndex
CREATE INDEX "ScriptExecution_machineId_status_idx" ON "ScriptExecution"("machineId", "status");

-- CreateIndex
CREATE INDEX "ScriptAuditLog_scriptId_createdAt_idx" ON "ScriptAuditLog"("scriptId", "createdAt");

-- CreateIndex
CREATE INDEX "ScriptAuditLog_userId_createdAt_idx" ON "ScriptAuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ScriptAuditLog_action_createdAt_idx" ON "ScriptAuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentScript" ADD CONSTRAINT "DepartmentScript_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentScript" ADD CONSTRAINT "DepartmentScript_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentScript" ADD CONSTRAINT "DepartmentScript_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptExecution" ADD CONSTRAINT "ScriptExecution_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptExecution" ADD CONSTRAINT "ScriptExecution_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptExecution" ADD CONSTRAINT "ScriptExecution_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptAuditLog" ADD CONSTRAINT "ScriptAuditLog_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptAuditLog" ADD CONSTRAINT "ScriptAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
