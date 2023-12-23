-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "deleted" BOOLEAN NOT NULL,
    "token" TEXT NOT NULL DEFAULT 'null',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "userImage" TEXT,
    "userType" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualMachine" (
    "id" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "status" BOOLEAN NOT NULL,
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,

    CONSTRAINT "VirtualMachine_pkey" PRIMARY KEY ("id")
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

    CONSTRAINT "MachineTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "message" TEXT,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_userImage_key" ON "User"("userImage");

-- AddForeignKey
ALTER TABLE "VirtualMachine" ADD CONSTRAINT "VirtualMachine_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MachineTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualMachine" ADD CONSTRAINT "VirtualMachine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
