import { PrismaClient, Prisma } from '@prisma/client'
import { beforeCreateMachine, afterCreateMachine } from './modelCallbacks/machine'
import { afterCreateDepartment } from './modelCallbacks/department'

/**
 * Creates a Prisma Client Extension with model lifecycle callbacks
 *
 * This replaces the old Prisma middleware ($use) which was removed in Prisma 5.
 * Now using Client Extensions pattern for before/after hooks on model operations.
 *
 * **IMPORTANT - Transaction Side-Effects Warning:**
 *
 * Callbacks execute within the database transaction context. Any external side-effects
 * performed in callbacks (e.g., creating libvirt filters, sending emails, calling APIs)
 * will NOT be rolled back if the transaction fails. This can lead to:
 *
 * - Orphaned libvirt filters if the database transaction rolls back
 * - Inconsistent state between database and external systems
 * - Resource leaks requiring manual cleanup
 *
 * **Mitigation Strategies:**
 *
 * 1. **Graceful Error Handling**: Callbacks should catch and log errors without
 *    throwing, allowing the main operation to succeed even if side-effects fail.
 *
 * 2. **Idempotent Operations**: Ensure side-effects can be safely retried or
 *    recreated (e.g., libvirt defineFilter is idempotent).
 *
 * 3. **Post-Commit Orchestration**: For critical consistency, consider moving
 *    side-effects to a post-commit phase using event emitters or job queues.
 *
 * 4. **Cleanup Strategies**: Implement cleanup jobs to detect and remove orphaned
 *    resources (e.g., libvirt filters without corresponding database records).
 *
 * 5. **Fallback Mechanisms**: Primary operations (like ensureFirewallForVM) should
 *    detect and repair missing resources created by callbacks.
 *
 * @param prisma - Base Prisma client instance
 * @returns Extended Prisma client with callback support
 */
export function createPrismaClientWithCallbacks (prisma: PrismaClient) {
  return prisma.$extends({
    name: 'ModelCallbacks',
    query: {
      // Machine model callbacks
      machine: {
        async create ({ args, query }) {
          // Run before callback
          await beforeCreateMachine(prisma, args)

          // Execute the actual query
          const result = await query(args)

          // Run after callback
          await afterCreateMachine(prisma, args, result)

          return result
        }
      },

      // Department model callbacks
      department: {
        async create ({ args, query }) {
          // Execute the query
          const result = await query(args)

          // Run after callback
          await afterCreateDepartment(prisma, args, result)

          return result
        }
      }
    }
  })
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use createPrismaClientWithCallbacks instead
 */
export default function installCallbacks (prisma: PrismaClient) {
  // This function is kept for backward compatibility but doesn't do anything
  // The actual extension is applied in database.ts when creating the client
  console.warn('installCallbacks is deprecated. Callbacks are now automatically applied via Prisma Client Extensions.')
}
