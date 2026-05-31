CREATE TABLE "IdentityGroupRoleMapping" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "groupDn" TEXT NOT NULL,
  "groupName" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IdentityGroupRoleMapping_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "IdentityGroupRoleMapping"
  ADD CONSTRAINT "IdentityGroupRoleMapping_providerId_fkey"
  FOREIGN KEY ("providerId")
  REFERENCES "IdentityProvider"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

CREATE UNIQUE INDEX "IdentityGroupRoleMapping_providerId_groupDn_key"
  ON "IdentityGroupRoleMapping"("providerId", "groupDn");

CREATE INDEX "IdentityGroupRoleMapping_providerId_idx"
  ON "IdentityGroupRoleMapping"("providerId");

CREATE INDEX "IdentityGroupRoleMapping_role_idx"
  ON "IdentityGroupRoleMapping"("role");
