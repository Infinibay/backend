-- CreateTable
CREATE TABLE "Iso" (
    "id" TEXT NOT NULL,
    "name" VARCHAR,
    "identifier" VARCHAR,
    "description" VARCHAR,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Iso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Disk" (
    "id" TEXT NOT NULL,
    "size" INTEGER,
    "format" VARCHAR,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "virtualMachineId" TEXT,

    CONSTRAINT "Disk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "path" VARCHAR,
    "hidden" BOOLEAN DEFAULT false,
    "value" TEXT DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" VARCHAR NOT NULL DEFAULT '',
    "password" VARCHAR NOT NULL DEFAULT '',
    "firstName" VARCHAR,
    "lastName" VARCHAR,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualMachine" (
    "id" TEXT NOT NULL,
    "name" VARCHAR,
    "identification" VARCHAR,
    "os" VARCHAR,
    "version" VARCHAR,
    "vcpus" INTEGER,
    "ram" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VirtualMachine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CdDevice" (
    "id" TEXT NOT NULL,
    "isoId" TEXT,
    "vmId" TEXT,

    CONSTRAINT "CdDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "index_disks_on_format" ON "Disk"("format");

-- CreateIndex
CREATE UNIQUE INDEX "index_users_on_email" ON "User"("email");

-- CreateIndex
CREATE INDEX "index_virtual_machines_on_os" ON "VirtualMachine"("os");

-- CreateIndex
CREATE INDEX "index_virtual_machines_on_vcpus" ON "VirtualMachine"("vcpus");

-- AddForeignKey
ALTER TABLE "Disk" ADD CONSTRAINT "Disk_virtualMachineId_fkey" FOREIGN KEY ("virtualMachineId") REFERENCES "VirtualMachine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CdDevice" ADD CONSTRAINT "CdDevice_isoId_fkey" FOREIGN KEY ("isoId") REFERENCES "Iso"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CdDevice" ADD CONSTRAINT "CdDevice_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "VirtualMachine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
