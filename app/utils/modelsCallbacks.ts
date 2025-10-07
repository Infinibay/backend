import { PrismaClient, Prisma } from '@prisma/client'
import { beforeCreateMachine, afterCreateMachine } from './modelCallbacks/machine'
import { afterCreateDepartment } from './modelCallbacks/department'

/**
 * Creates a Prisma Client Extension with model lifecycle callbacks
 *
 * This replaces the old Prisma middleware ($use) which was removed in Prisma 5.
 * Now using Client Extensions pattern for before/after hooks on model operations.
 *
 * @param prisma - Base Prisma client instance
 * @returns Extended Prisma client with callback support
 */
export function createPrismaClientWithCallbacks(prisma: PrismaClient) {
  return prisma.$extends({
    name: 'ModelCallbacks',
    query: {
      // Machine model callbacks
      machine: {
        async create({ args, query }) {
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
        async create({ args, query }) {
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
export default function installCallbacks(prisma: PrismaClient) {
  // This function is kept for backward compatibility but doesn't do anything
  // The actual extension is applied in database.ts when creating the client
  console.warn('installCallbacks is deprecated. Callbacks are now automatically applied via Prisma Client Extensions.')
}
