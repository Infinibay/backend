-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "Message" TEXT NOT NULL,
    " vmId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "Readed" BOOLEAN NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_ vmId_fkey" FOREIGN KEY (" vmId") REFERENCES "VirtualMachine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
