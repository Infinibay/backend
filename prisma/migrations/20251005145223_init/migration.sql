-- CreateEnum
CREATE TYPE "HealthCheckType" AS ENUM ('OVERALL_STATUS', 'DISK_SPACE', 'RESOURCE_OPTIMIZATION', 'WINDOWS_UPDATES', 'WINDOWS_DEFENDER', 'APPLICATION_INVENTORY', 'APPLICATION_UPDATES', 'SECURITY_CHECK', 'PERFORMANCE_CHECK', 'SYSTEM_HEALTH', 'CUSTOM_CHECK');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'RETRY_SCHEDULED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('URGENT', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "MaintenanceTaskType" AS ENUM ('DISK_CLEANUP', 'DEFRAG', 'WINDOWS_UPDATES', 'DEFENDER_SCAN', 'SYSTEM_FILE_CHECK', 'DISK_CHECK', 'REGISTRY_CLEANUP', 'CUSTOM_SCRIPT');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT', 'RUNNING');

-- CreateEnum
CREATE TYPE "MaintenanceTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- CreateEnum
CREATE TYPE "RecommendationType" AS ENUM ('DISK_SPACE_LOW', 'HIGH_CPU_APP', 'HIGH_RAM_APP', 'PORT_BLOCKED', 'OVER_PROVISIONED', 'UNDER_PROVISIONED', 'OS_UPDATE_AVAILABLE', 'APP_UPDATE_AVAILABLE', 'DEFENDER_DISABLED', 'DEFENDER_THREAT', 'OTHER');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN', 'SUPER_ADMIN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "deleted" BOOLEAN NOT NULL,
    "token" TEXT NOT NULL DEFAULT 'null',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "avatar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Node" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currentRaid" TEXT NOT NULL,
    "nextRaid" TEXT,
    "cpuFlags" JSONB NOT NULL,
    "ram" INTEGER NOT NULL,
    "cores" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Disk" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Disk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ISO" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "version" TEXT,
    "size" BIGINT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerified" TIMESTAMP(3),
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "checksum" TEXT,
    "downloadUrl" TEXT,
    "path" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ISO_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "internalName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "userId" TEXT,
    "templateId" TEXT,
    "os" TEXT NOT NULL,
    "cpuCores" INTEGER NOT NULL DEFAULT 0,
    "ramGB" INTEGER NOT NULL DEFAULT 0,
    "diskSizeGB" INTEGER NOT NULL DEFAULT 0,
    "gpuPciAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "departmentId" TEXT,
    "firewallTemplates" JSONB,
    "localIP" TEXT,
    "publicIP" TEXT,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineConfiguration" (
    "id" TEXT NOT NULL,
    "xml" JSONB,
    "graphicProtocol" TEXT,
    "graphicPort" INTEGER,
    "graphicPassword" TEXT,
    "graphicHost" TEXT,
    "assignedGpuBus" TEXT,
    "machineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachineConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cores" INTEGER NOT NULL,
    "ram" INTEGER NOT NULL,
    "storage" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "categoryId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachineTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineTemplateCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachineTemplateCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" TEXT,
    "url" TEXT,
    "icon" TEXT,
    "os" TEXT[],
    "installCommand" JSONB NOT NULL,
    "parameters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineApplication" (
    "machineId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachineApplication_pkey" PRIMARY KEY ("machineId","applicationId")
);

-- CreateTable
CREATE TABLE "PendingCommand" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "internetSpeed" INTEGER,
    "ipSubnet" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NWFilter" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "internalName" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "description" TEXT,
    "chain" TEXT,
    "type" TEXT NOT NULL DEFAULT 'generic',
    "priority" INTEGER NOT NULL DEFAULT 500,
    "stateMatch" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "flushedAt" TIMESTAMP(3),

    CONSTRAINT "NWFilter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilterReference" (
    "id" TEXT NOT NULL,
    "sourceFilterId" TEXT NOT NULL,
    "targetFilterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FilterReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentNWFilter" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "nwFilterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepartmentNWFilter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FWRule" (
    "id" TEXT NOT NULL,
    "nwFilterId" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'accept',
    "direction" TEXT NOT NULL DEFAULT 'inout',
    "priority" INTEGER NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'all',
    "ipVersion" TEXT,
    "srcMacAddr" TEXT,
    "srcIpAddr" TEXT,
    "srcIpMask" TEXT,
    "dstIpAddr" TEXT,
    "dstIpMask" TEXT,
    "srcPortStart" INTEGER,
    "srcPortEnd" INTEGER,
    "dstPortStart" INTEGER,
    "dstPortEnd" INTEGER,
    "state" JSONB,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FWRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentConfiguration" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "cleanTraffic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepartmentConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VMNWFilter" (
    "id" TEXT NOT NULL,
    "vmId" TEXT NOT NULL,
    "nwFilterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VMNWFilter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VmPort" (
    "id" TEXT NOT NULL,
    "portStart" INTEGER NOT NULL,
    "portEnd" INTEGER NOT NULL,
    "protocol" TEXT NOT NULL,
    "running" BOOLEAN NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "toEnable" BOOLEAN NOT NULL,
    "vmId" TEXT NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VmPort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentServiceConfig" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "useEnabled" BOOLEAN NOT NULL DEFAULT false,
    "provideEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepartmentServiceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VMServiceConfig" (
    "id" TEXT NOT NULL,
    "vmId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "useEnabled" BOOLEAN NOT NULL DEFAULT false,
    "provideEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VMServiceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalServiceConfig" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "useEnabled" BOOLEAN NOT NULL DEFAULT true,
    "provideEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalServiceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemMetrics" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "cpuUsagePercent" DOUBLE PRECISION NOT NULL,
    "cpuCoresUsage" JSONB NOT NULL,
    "cpuTemperature" DOUBLE PRECISION,
    "totalMemoryKB" BIGINT NOT NULL,
    "usedMemoryKB" BIGINT NOT NULL,
    "availableMemoryKB" BIGINT NOT NULL,
    "swapTotalKB" BIGINT,
    "swapUsedKB" BIGINT,
    "diskUsageStats" JSONB NOT NULL,
    "diskIOStats" JSONB NOT NULL,
    "networkStats" JSONB NOT NULL,
    "uptime" BIGINT NOT NULL,
    "loadAverage" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessSnapshot" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "processId" INTEGER NOT NULL,
    "parentPid" INTEGER,
    "name" TEXT NOT NULL,
    "executablePath" TEXT,
    "commandLine" TEXT,
    "cpuUsagePercent" DOUBLE PRECISION NOT NULL,
    "memoryUsageKB" BIGINT NOT NULL,
    "diskReadBytes" BIGINT,
    "diskWriteBytes" BIGINT,
    "status" TEXT NOT NULL,
    "startTime" TIMESTAMP(3),
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationUsage" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "executablePath" TEXT NOT NULL,
    "applicationName" TEXT NOT NULL,
    "version" TEXT,
    "description" TEXT,
    "publisher" TEXT,
    "lastAccessTime" TIMESTAMP(3),
    "lastModifiedTime" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "totalUsageMinutes" INTEGER NOT NULL DEFAULT 0,
    "iconData" BYTEA,
    "iconFormat" TEXT,
    "fileSize" BIGINT,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortUsage" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "protocol" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "processId" INTEGER,
    "processName" TEXT,
    "executablePath" TEXT,
    "isListening" BOOLEAN NOT NULL DEFAULT false,
    "connectionCount" INTEGER NOT NULL DEFAULT 0,
    "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WindowsService" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "startType" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "executablePath" TEXT,
    "dependencies" JSONB,
    "currentState" TEXT NOT NULL,
    "processId" INTEGER,
    "lastStateChange" TIMESTAMP(3),
    "stateChangeCount" INTEGER NOT NULL DEFAULT 0,
    "isDefaultService" BOOLEAN NOT NULL DEFAULT false,
    "usageScore" DOUBLE PRECISION DEFAULT 0,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WindowsService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceStateHistory" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT NOT NULL,
    "reason" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceStateHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "context" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceMetric" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "tags" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceAggregate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "sum" DOUBLE PRECISION NOT NULL,
    "min" DOUBLE PRECISION NOT NULL,
    "max" DOUBLE PRECISION NOT NULL,
    "avg" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthCheck" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "details" JSONB,
    "responseTime" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundTaskLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "taskName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundTaskLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VMHealthAlert" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "remediation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VMHealthAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VMHealthConfig" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "checkIntervalMinutes" INTEGER NOT NULL DEFAULT 5,
    "metricsRetentionDays" INTEGER NOT NULL DEFAULT 7,
    "thresholds" JSONB NOT NULL,
    "enabledModules" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VMHealthConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnownService" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "ports" JSONB NOT NULL,
    "executable" TEXT,
    "os" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnownService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemEvent" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VMHealthSnapshot" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "overallStatus" TEXT NOT NULL,
    "diskSpaceInfo" JSONB,
    "resourceOptInfo" JSONB,
    "windowsUpdateInfo" JSONB,
    "defenderStatus" JSONB,
    "applicationInventory" JSONB,
    "customCheckResults" JSONB,
    "osType" TEXT,
    "checksCompleted" INTEGER NOT NULL DEFAULT 0,
    "checksFailed" INTEGER NOT NULL DEFAULT 0,
    "executionTimeMs" INTEGER,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VMHealthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VMHealthCheckQueue" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "checkType" "HealthCheckType" NOT NULL,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "result" JSONB,
    "executionTimeMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VMHealthCheckQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceTask" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "taskType" "MaintenanceTaskType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "cronSchedule" TEXT,
    "runAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "parameters" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "executionStatus" TEXT NOT NULL DEFAULT 'IDLE',

    CONSTRAINT "MaintenanceTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceHistory" (
    "id" TEXT NOT NULL,
    "taskId" TEXT,
    "machineId" TEXT NOT NULL,
    "taskType" "MaintenanceTaskType" NOT NULL,
    "status" "MaintenanceStatus" NOT NULL,
    "duration" INTEGER,
    "result" JSONB,
    "error" TEXT,
    "triggeredBy" "MaintenanceTrigger" NOT NULL,
    "executedByUserId" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VMRecommendation" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "type" "RecommendationType" NOT NULL,
    "text" TEXT NOT NULL,
    "actionText" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VMRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "wallpaper" TEXT NOT NULL DEFAULT 'wallpaper1.jpg',
    "logoUrl" TEXT,
    "interfaceSize" TEXT NOT NULL DEFAULT 'xl',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ISO_filename_key" ON "ISO"("filename");

-- CreateIndex
CREATE UNIQUE INDEX "MachineConfiguration_machineId_key" ON "MachineConfiguration"("machineId");

-- CreateIndex
CREATE INDEX "PendingCommand_machineId_idx" ON "PendingCommand"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "NWFilter_name_key" ON "NWFilter"("name");

-- CreateIndex
CREATE UNIQUE INDEX "NWFilter_internalName_key" ON "NWFilter"("internalName");

-- CreateIndex
CREATE UNIQUE INDEX "NWFilter_uuid_key" ON "NWFilter"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "FilterReference_sourceFilterId_targetFilterId_key" ON "FilterReference"("sourceFilterId", "targetFilterId");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentNWFilter_departmentId_nwFilterId_key" ON "DepartmentNWFilter"("departmentId", "nwFilterId");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentConfiguration_departmentId_key" ON "DepartmentConfiguration"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "VMNWFilter_vmId_nwFilterId_key" ON "VMNWFilter"("vmId", "nwFilterId");

-- CreateIndex
CREATE UNIQUE INDEX "VmPort_vmId_portStart_protocol_key" ON "VmPort"("vmId", "portStart", "protocol");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentServiceConfig_departmentId_serviceId_key" ON "DepartmentServiceConfig"("departmentId", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "VMServiceConfig_vmId_serviceId_key" ON "VMServiceConfig"("vmId", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalServiceConfig_serviceId_key" ON "GlobalServiceConfig"("serviceId");

-- CreateIndex
CREATE INDEX "SystemMetrics_machineId_timestamp_idx" ON "SystemMetrics"("machineId", "timestamp");

-- CreateIndex
CREATE INDEX "ProcessSnapshot_machineId_timestamp_idx" ON "ProcessSnapshot"("machineId", "timestamp");

-- CreateIndex
CREATE INDEX "ProcessSnapshot_machineId_processId_timestamp_idx" ON "ProcessSnapshot"("machineId", "processId", "timestamp");

-- CreateIndex
CREATE INDEX "ApplicationUsage_machineId_lastAccessTime_idx" ON "ApplicationUsage"("machineId", "lastAccessTime");

-- CreateIndex
CREATE INDEX "ApplicationUsage_machineId_isActive_idx" ON "ApplicationUsage"("machineId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationUsage_machineId_executablePath_key" ON "ApplicationUsage"("machineId", "executablePath");

-- CreateIndex
CREATE INDEX "PortUsage_machineId_port_protocol_idx" ON "PortUsage"("machineId", "port", "protocol");

-- CreateIndex
CREATE INDEX "PortUsage_machineId_timestamp_idx" ON "PortUsage"("machineId", "timestamp");

-- CreateIndex
CREATE INDEX "PortUsage_machineId_isListening_idx" ON "PortUsage"("machineId", "isListening");

-- CreateIndex
CREATE INDEX "WindowsService_machineId_currentState_idx" ON "WindowsService"("machineId", "currentState");

-- CreateIndex
CREATE INDEX "WindowsService_machineId_isDefaultService_idx" ON "WindowsService"("machineId", "isDefaultService");

-- CreateIndex
CREATE UNIQUE INDEX "WindowsService_machineId_serviceName_key" ON "WindowsService"("machineId", "serviceName");

-- CreateIndex
CREATE INDEX "ServiceStateHistory_serviceId_timestamp_idx" ON "ServiceStateHistory"("serviceId", "timestamp");

-- CreateIndex
CREATE INDEX "ErrorLog_timestamp_idx" ON "ErrorLog"("timestamp");

-- CreateIndex
CREATE INDEX "ErrorLog_severity_timestamp_idx" ON "ErrorLog"("severity", "timestamp");

-- CreateIndex
CREATE INDEX "ErrorLog_code_timestamp_idx" ON "ErrorLog"("code", "timestamp");

-- CreateIndex
CREATE INDEX "PerformanceMetric_name_timestamp_idx" ON "PerformanceMetric"("name", "timestamp");

-- CreateIndex
CREATE INDEX "PerformanceMetric_timestamp_idx" ON "PerformanceMetric"("timestamp");

-- CreateIndex
CREATE INDEX "PerformanceAggregate_name_period_timestamp_idx" ON "PerformanceAggregate"("name", "period", "timestamp");

-- CreateIndex
CREATE INDEX "PerformanceAggregate_timestamp_idx" ON "PerformanceAggregate"("timestamp");

-- CreateIndex
CREATE INDEX "HealthCheck_service_timestamp_idx" ON "HealthCheck"("service", "timestamp");

-- CreateIndex
CREATE INDEX "HealthCheck_status_timestamp_idx" ON "HealthCheck"("status", "timestamp");

-- CreateIndex
CREATE INDEX "HealthCheck_timestamp_idx" ON "HealthCheck"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundTaskLog_taskId_key" ON "BackgroundTaskLog"("taskId");

-- CreateIndex
CREATE INDEX "BackgroundTaskLog_status_createdAt_idx" ON "BackgroundTaskLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BackgroundTaskLog_taskName_createdAt_idx" ON "BackgroundTaskLog"("taskName", "createdAt");

-- CreateIndex
CREATE INDEX "BackgroundTaskLog_createdAt_idx" ON "BackgroundTaskLog"("createdAt");

-- CreateIndex
CREATE INDEX "VMHealthAlert_machineId_resolved_idx" ON "VMHealthAlert"("machineId", "resolved");

-- CreateIndex
CREATE INDEX "VMHealthAlert_machineId_severity_idx" ON "VMHealthAlert"("machineId", "severity");

-- CreateIndex
CREATE INDEX "VMHealthAlert_createdAt_idx" ON "VMHealthAlert"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VMHealthConfig_machineId_key" ON "VMHealthConfig"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "KnownService_name_key" ON "KnownService"("name");

-- CreateIndex
CREATE INDEX "SystemEvent_machineId_timestamp_idx" ON "SystemEvent"("machineId", "timestamp");

-- CreateIndex
CREATE INDEX "SystemEvent_machineId_eventType_idx" ON "SystemEvent"("machineId", "eventType");

-- CreateIndex
CREATE INDEX "VMHealthSnapshot_machineId_snapshotDate_idx" ON "VMHealthSnapshot"("machineId", "snapshotDate");

-- CreateIndex
CREATE INDEX "VMHealthSnapshot_snapshotDate_idx" ON "VMHealthSnapshot"("snapshotDate");

-- CreateIndex
CREATE INDEX "VMHealthSnapshot_machineId_overallStatus_idx" ON "VMHealthSnapshot"("machineId", "overallStatus");

-- CreateIndex
CREATE INDEX "VMHealthCheckQueue_machineId_status_idx" ON "VMHealthCheckQueue"("machineId", "status");

-- CreateIndex
CREATE INDEX "VMHealthCheckQueue_status_priority_scheduledFor_idx" ON "VMHealthCheckQueue"("status", "priority", "scheduledFor");

-- CreateIndex
CREATE INDEX "VMHealthCheckQueue_scheduledFor_status_idx" ON "VMHealthCheckQueue"("scheduledFor", "status");

-- CreateIndex
CREATE INDEX "VMHealthCheckQueue_machineId_checkType_status_idx" ON "VMHealthCheckQueue"("machineId", "checkType", "status");

-- CreateIndex
CREATE INDEX "MaintenanceTask_machineId_isEnabled_idx" ON "MaintenanceTask"("machineId", "isEnabled");

-- CreateIndex
CREATE INDEX "MaintenanceTask_machineId_taskType_idx" ON "MaintenanceTask"("machineId", "taskType");

-- CreateIndex
CREATE INDEX "MaintenanceTask_nextRunAt_isEnabled_idx" ON "MaintenanceTask"("nextRunAt", "isEnabled");

-- CreateIndex
CREATE INDEX "MaintenanceTask_taskType_isEnabled_idx" ON "MaintenanceTask"("taskType", "isEnabled");

-- CreateIndex
CREATE INDEX "MaintenanceHistory_machineId_executedAt_idx" ON "MaintenanceHistory"("machineId", "executedAt");

-- CreateIndex
CREATE INDEX "MaintenanceHistory_machineId_status_idx" ON "MaintenanceHistory"("machineId", "status");

-- CreateIndex
CREATE INDEX "MaintenanceHistory_taskType_status_idx" ON "MaintenanceHistory"("taskType", "status");

-- CreateIndex
CREATE INDEX "MaintenanceHistory_executedAt_idx" ON "MaintenanceHistory"("executedAt");

-- CreateIndex
CREATE INDEX "VMRecommendation_machineId_createdAt_idx" ON "VMRecommendation"("machineId", "createdAt");

-- CreateIndex
CREATE INDEX "VMRecommendation_machineId_snapshotId_idx" ON "VMRecommendation"("machineId", "snapshotId");

-- CreateIndex
CREATE INDEX "AppSettings_id_idx" ON "AppSettings"("id");

-- AddForeignKey
ALTER TABLE "Disk" ADD CONSTRAINT "Disk_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MachineTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineConfiguration" ADD CONSTRAINT "MachineConfiguration_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineTemplate" ADD CONSTRAINT "MachineTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MachineTemplateCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineApplication" ADD CONSTRAINT "MachineApplication_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineApplication" ADD CONSTRAINT "MachineApplication_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingCommand" ADD CONSTRAINT "PendingCommand_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilterReference" ADD CONSTRAINT "FilterReference_sourceFilterId_fkey" FOREIGN KEY ("sourceFilterId") REFERENCES "NWFilter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilterReference" ADD CONSTRAINT "FilterReference_targetFilterId_fkey" FOREIGN KEY ("targetFilterId") REFERENCES "NWFilter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentNWFilter" ADD CONSTRAINT "DepartmentNWFilter_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentNWFilter" ADD CONSTRAINT "DepartmentNWFilter_nwFilterId_fkey" FOREIGN KEY ("nwFilterId") REFERENCES "NWFilter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FWRule" ADD CONSTRAINT "FWRule_nwFilterId_fkey" FOREIGN KEY ("nwFilterId") REFERENCES "NWFilter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentConfiguration" ADD CONSTRAINT "DepartmentConfiguration_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VMNWFilter" ADD CONSTRAINT "VMNWFilter_nwFilterId_fkey" FOREIGN KEY ("nwFilterId") REFERENCES "NWFilter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VMNWFilter" ADD CONSTRAINT "VMNWFilter_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VmPort" ADD CONSTRAINT "VmPort_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentServiceConfig" ADD CONSTRAINT "DepartmentServiceConfig_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VMServiceConfig" ADD CONSTRAINT "VMServiceConfig_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemMetrics" ADD CONSTRAINT "SystemMetrics_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessSnapshot" ADD CONSTRAINT "ProcessSnapshot_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationUsage" ADD CONSTRAINT "ApplicationUsage_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortUsage" ADD CONSTRAINT "PortUsage_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WindowsService" ADD CONSTRAINT "WindowsService_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceStateHistory" ADD CONSTRAINT "ServiceStateHistory_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "WindowsService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VMHealthAlert" ADD CONSTRAINT "VMHealthAlert_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VMHealthConfig" ADD CONSTRAINT "VMHealthConfig_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemEvent" ADD CONSTRAINT "SystemEvent_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VMHealthSnapshot" ADD CONSTRAINT "VMHealthSnapshot_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VMHealthCheckQueue" ADD CONSTRAINT "VMHealthCheckQueue_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTask" ADD CONSTRAINT "MaintenanceTask_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTask" ADD CONSTRAINT "MaintenanceTask_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceHistory" ADD CONSTRAINT "MaintenanceHistory_executedByUserId_fkey" FOREIGN KEY ("executedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceHistory" ADD CONSTRAINT "MaintenanceHistory_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceHistory" ADD CONSTRAINT "MaintenanceHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MaintenanceTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VMRecommendation" ADD CONSTRAINT "VMRecommendation_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VMRecommendation" ADD CONSTRAINT "VMRecommendation_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "VMHealthSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
