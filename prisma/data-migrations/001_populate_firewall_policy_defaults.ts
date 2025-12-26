/**
 * Data Migration: Populate default firewall policy for existing departments
 *
 * This migration ensures all departments have consistent firewall policy settings.
 * Since Prisma schema migration already sets defaults for new rows, this migration
 * is primarily for edge cases where NULL values might exist.
 */

import { PrismaClient } from '@prisma/client';

export const migration = {
  id: '001_populate_firewall_policy_defaults',
  description: 'Populate default firewall policy for existing departments',

  /**
   * Check if this migration needs to run.
   * Return true if there are departments without proper firewall config.
   */
  async shouldRun(prisma: PrismaClient): Promise<boolean> {
    // Check if there are departments without firewall policy set
    // Note: With NOT NULL constraint and DEFAULT, this should rarely be needed
    const count = await prisma.department.count({
      where: {
        firewallDefaultConfig: null,
      },
    });
    return count > 0;
  },

  /**
   * Execute the migration.
   * Set default firewall configuration for departments missing it.
   */
  async up(prisma: PrismaClient): Promise<void> {
    console.log('Setting default firewall policy for existing departments...');

    const result = await prisma.department.updateMany({
      where: {
        firewallDefaultConfig: null,
      },
      data: {
        firewallDefaultConfig: 'allow_outbound',
      },
    });

    console.log(`Updated ${result.count} departments with default firewall policy`);
  },

  /**
   * Rollback the migration (optional).
   * In most cases, database restore handles rollback during failed updates.
   */
  async down(prisma: PrismaClient): Promise<void> {
    console.log('Rollback not needed - database restore will handle it');
  },
};

export default migration;

// Main execution block - called by run.sh via ts-node
async function main() {
  const prisma = new PrismaClient();

  try {
    const needsRun = await migration.shouldRun(prisma);

    if (!needsRun) {
      console.log(`Migration ${migration.id}: No changes needed, skipping`);
      return;
    }

    await migration.up(prisma);
    console.log(`Migration ${migration.id}: Completed successfully`);
  } catch (error) {
    console.error(`Migration ${migration.id}: Failed with error:`, error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
