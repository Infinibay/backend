-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "First_Name" TEXT NOT NULL,
    "Last_Name" TEXT NOT NULL,
    "Email" TEXT NOT NULL,
    "Password" TEXT NOT NULL,
    "Deleted" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualMachine" (
    "id" TEXT NOT NULL,
    "GU_ID" TEXT NOT NULL,
    "Config" JSONB NOT NULL,
    "Status" BOOLEAN NOT NULL,
    "VirtualMachine_Name" TEXT NOT NULL,
    "Title" TEXT NOT NULL,
    "Description" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "VirtualMachine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VirtualMachine_GU_ID_key" ON "VirtualMachine"("GU_ID");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualMachine_VirtualMachine_Name_key" ON "VirtualMachine"("VirtualMachine_Name");

-- AddForeignKey
ALTER TABLE "VirtualMachine" ADD CONSTRAINT "VirtualMachine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
