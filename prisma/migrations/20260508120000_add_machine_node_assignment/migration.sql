-- Track the host node where each VM is assigned.
-- Nullable for existing single-node installs and for machines created before
-- the local node has been registered by setupNode.
ALTER TABLE "Machine" ADD COLUMN "nodeId" TEXT;

CREATE INDEX "Machine_nodeId_idx" ON "Machine"("nodeId");

ALTER TABLE "Machine"
ADD CONSTRAINT "Machine_nodeId_fkey"
FOREIGN KEY ("nodeId") REFERENCES "Node"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
