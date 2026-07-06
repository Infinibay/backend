-- First-run setup state on AppSettings (see lxd/docs/setup-system).
-- Structural columns default to the "not yet configured" state. The trailing
-- UPDATE backfills any AppSettings row that ALREADY EXISTS at migration time to
-- "completed": such a row belongs to an install that is already past first-run
-- setup, so it must not suddenly be sent to /setup. A fresh install has no
-- AppSettings row yet at this point (the seed creates it AFTER migrations run,
-- with setupCompleted=false), so the UPDATE affects zero rows there.

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "devModeAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "setupCompleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "setupCompletedAt" TIMESTAMP(3),
ADD COLUMN     "setupPhase" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "setupStartedAt" TIMESTAMP(3),
ADD COLUMN     "storageConfig" JSONB;

-- Backfill existing installs (already past setup).
UPDATE "AppSettings" SET "setupCompleted" = true, "setupPhase" = 'completed', "setupCompletedAt" = CURRENT_TIMESTAMP;
