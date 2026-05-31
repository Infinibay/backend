-- CreateTable
CREATE TABLE "BlockedConnection" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "protocol" TEXT NOT NULL,
    "processName" TEXT,
    "processId" INTEGER,
    "attemptTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockReason" TEXT NOT NULL,
    "sourceIp" TEXT,
    "ruleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockedConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BlockedConnection_machineId_attemptTime_idx" ON "BlockedConnection"("machineId", "attemptTime");

-- CreateIndex
CREATE INDEX "BlockedConnection_machineId_port_protocol_idx" ON "BlockedConnection"("machineId", "port", "protocol");

-- AddForeignKey
ALTER TABLE "BlockedConnection" ADD CONSTRAINT "BlockedConnection_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
