-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "dnsServers" TEXT[] DEFAULT ARRAY['8.8.8.8', '8.8.4.4', '1.1.1.1']::TEXT[],
ADD COLUMN     "ntpServers" TEXT[] DEFAULT ARRAY['time.google.com', 'time.cloudflare.com']::TEXT[];
