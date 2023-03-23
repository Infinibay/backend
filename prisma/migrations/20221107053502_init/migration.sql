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
    "guId " TEXT NOT NULL,
    "Config" JSONB NOT NULL,
    "Status" BOOLEAN NOT NULL,
    "virtualMachineName" TEXT NOT NULL,
    "Title" TEXT NOT NULL,
    "Description" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "VirtualMachine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VirtualMachine_guId _key" ON "VirtualMachine"("guId ");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualMachine_virtualMachineName_key" ON "VirtualMachine"("virtualMachineName");

-- AddForeignKey
ALTER TABLE "VirtualMachine" ADD CONSTRAINT "VirtualMachine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
