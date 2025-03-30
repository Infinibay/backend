-- Add direction column to VmPort table
ALTER TABLE "VmPort" ADD COLUMN "direction" TEXT NOT NULL DEFAULT 'BOTH';

-- Add direction column to DepartmentServiceConfig
ALTER TABLE "DepartmentServiceConfig" ADD COLUMN "direction" TEXT NOT NULL DEFAULT 'BOTH';

-- Add direction column to GlobalServiceConfig
ALTER TABLE "GlobalServiceConfig" ADD COLUMN "direction" TEXT NOT NULL DEFAULT 'BOTH';

-- Add comment explaining direction options
COMMENT ON COLUMN "VmPort"."direction" IS 'Service direction: USE (outbound), PROVIDE (inbound), or BOTH';
COMMENT ON COLUMN "DepartmentServiceConfig"."direction" IS 'Service direction: USE (outbound), PROVIDE (inbound), or BOTH';
COMMENT ON COLUMN "GlobalServiceConfig"."direction" IS 'Service direction: USE (outbound), PROVIDE (inbound), or BOTH';
