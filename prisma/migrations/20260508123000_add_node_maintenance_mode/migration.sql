-- Operators need a simple way to drain/maintain nodes without receiving new VMs.
ALTER TABLE "Node" ADD COLUMN "maintenanceMode" BOOLEAN NOT NULL DEFAULT false;
