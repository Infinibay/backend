-- AlterTable
ALTER TABLE "Machine" ADD COLUMN     "poolId" TEXT;

-- CreateTable
CREATE TABLE "Pool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "goldenImageId" TEXT,
    "departmentId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'non-persistent',
    "sizeMin" INTEGER NOT NULL DEFAULT 0,
    "sizeMax" INTEGER NOT NULL DEFAULT 10,
    "idleTimeoutMinutes" INTEGER,
    "resetOnLogoff" BOOLEAN NOT NULL DEFAULT true,
    "draining" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pool_departmentId_idx" ON "Pool"("departmentId");

-- CreateIndex
CREATE INDEX "Pool_templateId_idx" ON "Pool"("templateId");

-- CreateIndex
CREATE INDEX "Pool_goldenImageId_idx" ON "Pool"("goldenImageId");

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pool" ADD CONSTRAINT "Pool_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MachineTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pool" ADD CONSTRAINT "Pool_goldenImageId_fkey" FOREIGN KEY ("goldenImageId") REFERENCES "GoldenImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pool" ADD CONSTRAINT "Pool_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
