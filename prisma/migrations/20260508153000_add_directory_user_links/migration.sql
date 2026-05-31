-- Link synchronized directory users back to their identity provider.
ALTER TABLE "User"
  ADD COLUMN "identityProviderId" TEXT,
  ADD COLUMN "externalId" TEXT,
  ADD COLUMN "externalDn" TEXT,
  ADD COLUMN "lastDirectorySyncAt" TIMESTAMP(3);

ALTER TABLE "User"
  ADD CONSTRAINT "User_identityProviderId_fkey"
  FOREIGN KEY ("identityProviderId")
  REFERENCES "IdentityProvider"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE UNIQUE INDEX "User_identityProviderId_externalId_key"
  ON "User"("identityProviderId", "externalId");

CREATE INDEX "User_identityProviderId_idx"
  ON "User"("identityProviderId");
