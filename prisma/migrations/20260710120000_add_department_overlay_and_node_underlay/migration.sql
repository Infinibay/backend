-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "gatewayNodeId" TEXT,
ADD COLUMN     "overlayMode" TEXT NOT NULL DEFAULT 'local',
ADD COLUMN     "overlayMtu" INTEGER NOT NULL DEFAULT 1370,
ADD COLUMN     "vni" INTEGER;

-- CreateTable
CREATE TABLE "NodeUnderlay" (
    "nodeId" TEXT NOT NULL,
    "vtepIp" TEXT NOT NULL,
    "mgmtIp" TEXT,
    "wgPubKey" TEXT NOT NULL,
    "wgEndpoint" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeUnderlay_pkey" PRIMARY KEY ("nodeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_vni_key" ON "Department"("vni");

-- AddForeignKey
ALTER TABLE "NodeUnderlay" ADD CONSTRAINT "NodeUnderlay_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_gatewayNodeId_fkey" FOREIGN KEY ("gatewayNodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;
