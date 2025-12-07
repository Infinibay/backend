/**
 * Data Migration Template
 *
 * Copy this file to create a new data migration.
 * Naming convention: NNN_descriptive_name.ts (e.g., 001_populate_department_ids.ts)
 *
 * WHEN TO USE DATA MIGRATIONS:
 * - Populating new columns from existing data
 * - Transforming JSON fields to normalized columns
 * - Backfilling computed values
 * - Complex data cleanup and normalization
 *
 * Data migrations run AFTER Prisma schema migrations, so the schema
 * will already have the new structure when this migration executes.
 *
 * BEST PRACTICES:
 * - Make migrations idempotent (safe to run multiple times)
 * - Use transactions for multi-step operations
 * - Log progress for long-running migrations
 * - Handle edge cases (null values, missing related records)
 * - Test with production-like data volumes
 * - Consider batching for large datasets to avoid memory issues
 */

import { PrismaClient } from '@prisma/client';

export const migration = {
  // REQUIRED: Change this to match your filename without .ts extension
  // Example: if file is 001_populate_departments.ts, set id to '001_populate_departments'
  // WARNING: Leaving the default value will cause registry collisions with other migrations!
  id: 'CHANGE_ME_TO_MATCH_FILENAME',

  // REQUIRED: Update this to describe what your migration does
  description: 'CHANGE_ME_TO_DESCRIBE_MIGRATION',

  /**
   * Check if this migration needs to run.
   * Return true if there's work to do, false to skip.
   * This enables idempotent migrations - safe to run multiple times.
   */
  async shouldRun(prisma: PrismaClient): Promise<boolean> {
    // Example: Check if there are machines without a departmentId
    const count = await prisma.machine.count({
      where: { departmentId: null },
    });
    return count > 0;
  },

  /**
   * Execute the migration.
   * This is where the actual data transformation happens.
   */
  async up(prisma: PrismaClient): Promise<void> {
    console.log('Populating departmentId for machines...');

    // Get or create default department
    let defaultDept = await prisma.department.findFirst({
      where: { name: 'Default' },
    });

    if (!defaultDept) {
      defaultDept = await prisma.department.create({
        data: {
          name: 'Default',
        },
      });
      console.log(`Created default department: ${defaultDept.id}`);
    }

    // Update machines without department
    const result = await prisma.machine.updateMany({
      where: { departmentId: null },
      data: { departmentId: defaultDept.id },
    });

    console.log(`Updated ${result.count} machines with default department`);
  },

  /**
   * Rollback the migration (optional).
   * In most cases, database restore handles rollback during failed updates.
   * Implement this only if you need programmatic rollback capability.
   */
  async down(prisma: PrismaClient): Promise<void> {
    // For this migration, rollback would set departmentId back to null
    // But this might not be safe if schema requires departmentId
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
