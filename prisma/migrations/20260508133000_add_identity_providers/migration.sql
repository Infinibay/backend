CREATE TYPE "IdentityProviderType" AS ENUM ('ACTIVE_DIRECTORY', 'LDAP');

CREATE TYPE "IdentityProviderStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR', 'SYNCING');

CREATE TYPE "IdentitySyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'ERROR');

CREATE TABLE "IdentityProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerType" "IdentityProviderType" NOT NULL,
    "status" "IdentityProviderStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "domain" TEXT,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 389,
    "useTls" BOOLEAN NOT NULL DEFAULT false,
    "baseDn" TEXT NOT NULL,
    "bindDn" TEXT,
    "bindPasswordSecret" TEXT,
    "userFilter" TEXT,
    "groupFilter" TEXT,
    "attributes" JSONB,
    "lastTestAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentityProvider_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IdentitySyncRun" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" "IdentitySyncStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "usersCreated" INTEGER NOT NULL DEFAULT 0,
    "usersUpdated" INTEGER NOT NULL DEFAULT 0,
    "usersDisabled" INTEGER NOT NULL DEFAULT 0,
    "groupsSeen" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "error" TEXT,

    CONSTRAINT "IdentitySyncRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdentityProvider_name_key" ON "IdentityProvider"("name");
CREATE INDEX "IdentityProvider_providerType_idx" ON "IdentityProvider"("providerType");
CREATE INDEX "IdentityProvider_status_idx" ON "IdentityProvider"("status");
CREATE INDEX "IdentitySyncRun_providerId_startedAt_idx" ON "IdentitySyncRun"("providerId", "startedAt");
CREATE INDEX "IdentitySyncRun_status_idx" ON "IdentitySyncRun"("status");

ALTER TABLE "IdentitySyncRun" ADD CONSTRAINT "IdentitySyncRun_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "IdentityProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
