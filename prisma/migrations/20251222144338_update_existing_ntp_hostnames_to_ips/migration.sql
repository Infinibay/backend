-- Data Migration: Update existing Department NTP hostnames to IP addresses
-- DHCP option 42 requires IP addresses, not hostnames. This migration converts
-- existing departments that have the old hostname defaults to use valid IP addresses.

-- Update departments that have the exact old default values
UPDATE "Department"
SET "ntpServers" = ARRAY['216.239.35.0', '162.159.200.1']::TEXT[]
WHERE "ntpServers" = ARRAY['time.google.com', 'time.cloudflare.com']::TEXT[];

-- Also handle case where order might be reversed
UPDATE "Department"
SET "ntpServers" = ARRAY['216.239.35.0', '162.159.200.1']::TEXT[]
WHERE "ntpServers" = ARRAY['time.cloudflare.com', 'time.google.com']::TEXT[];
