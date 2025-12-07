# Data Migrations

This directory contains data migration scripts that handle complex data transformations after Prisma schema migrations.

## Overview

Data migrations handle transformations that Prisma schema migrations cannot do:

- **Populating new columns from existing data** - e.g., computing values from other fields
- **Transforming JSON fields to normalized columns** - e.g., extracting nested data into separate columns
- **Backfilling computed values** - e.g., calculating aggregates for existing records
- **Complex data cleanup and normalization** - e.g., fixing data inconsistencies

## When to Use Data Migrations

| Use Prisma Schema Migrations | Use Data Migrations |
|------------------------------|---------------------|
| Adding/removing tables | Populating new columns with existing data |
| Adding/removing columns | Transforming data between columns |
| Adding/removing indexes | Backfilling computed values |
| Changing column types | Complex multi-step data operations |
| Adding constraints | Data cleanup and normalization |

**Important**: Data migrations always run AFTER Prisma schema migrations. The schema will already have the new structure when data migrations execute.

## Creating a New Migration

1. **Copy the template**:
   ```bash
   cp template.ts 001_descriptive_name.ts
   ```

2. **Follow the naming convention**: `NNN_descriptive_name.ts`
   - `NNN` is a zero-padded number (001, 002, etc.)
   - `descriptive_name` explains what the migration does
   - Examples: `001_populate_department_ids.ts`, `002_transform_firewall_rules.ts`

3. **Update the migration ID** to match the filename (without `.ts`):
   ```typescript
   id: '001_descriptive_name',
   ```

   **WARNING**: The `id` field MUST be unique and match your filename. Leaving the default placeholder value (`CHANGE_ME_TO_MATCH_FILENAME`) will cause registry collisions where multiple migrations appear as the same migration, leading to skipped migrations or corrupted registry state.

4. **Write a clear description**:
   ```typescript
   description: 'Populate departmentId for existing machines without a department',
   ```

5. **Implement `shouldRun()`** to check if migration is needed:
   ```typescript
   async shouldRun(prisma: PrismaClient): Promise<boolean> {
     const count = await prisma.machine.count({
       where: { departmentId: null }
     });
     return count > 0;
   }
   ```

6. **Implement `up()`** with the actual data transformation:
   ```typescript
   async up(prisma: PrismaClient): Promise<void> {
     // Your migration logic here
     console.log('Starting migration...');
     // ... transformation code ...
     console.log('Migration complete');
   }
   ```

7. **Optionally implement `down()`** for rollback (usually not needed):
   ```typescript
   async down(prisma: PrismaClient): Promise<void> {
     console.log('Rollback handled by database restore');
   }
   ```

8. **Test locally** before committing

## Migration Structure

Each migration file must export a `migration` object with these methods:

```typescript
import { PrismaClient } from '@prisma/client';

export const migration = {
  id: 'NNN_descriptive_name',      // Must match filename
  description: 'What this does',   // Human-readable description

  async shouldRun(prisma: PrismaClient): Promise<boolean> {
    // Return true if migration needs to run
  },

  async up(prisma: PrismaClient): Promise<void> {
    // Execute the data transformation
  },

  async down(prisma: PrismaClient): Promise<void> {
    // Optional rollback logic
  }
};

export default migration;

// Main execution block
async function main() {
  const prisma = new PrismaClient();
  try {
    if (await migration.shouldRun(prisma)) {
      await migration.up(prisma);
    }
  } finally {
    await prisma.$disconnect();
  }
}
main();
```

See `template.ts` for a complete working example.

## Execution

### Automatic (During Updates)

Migrations run automatically during `./run.sh update` after Prisma schema migrations complete:

```
1. Prisma schema migration (creates/alters tables)
2. Data migrations (populates/transforms data)
3. Service restart
```

### Manual Execution

Inside the backend container:
```bash
bash /opt/infinibay/backend/prisma/data-migrations/run.sh
```

### Execution Order

- Migrations run in alphabetical order by filename
- Already-applied migrations are skipped (tracked in `registry.json`)
- If a migration fails, the entire update process rolls back

## Best Practices

### Make Migrations Idempotent

Migrations should be safe to run multiple times. The `shouldRun()` method enables this:

```typescript
async shouldRun(prisma: PrismaClient): Promise<boolean> {
  // Only run if there's work to do
  const count = await prisma.machine.count({
    where: { departmentId: null }
  });
  return count > 0;
}
```

### Use Transactions for Multi-Step Operations

```typescript
async up(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Step 1
    await tx.department.create({ ... });
    // Step 2
    await tx.machine.updateMany({ ... });
  });
}
```

### Log Progress for Long-Running Migrations

```typescript
async up(prisma: PrismaClient): Promise<void> {
  const total = await prisma.machine.count();
  console.log(`Processing ${total} machines...`);

  // ... process ...

  console.log(`Updated ${result.count} machines`);
}
```

### Handle Large Datasets with Batching

```typescript
async up(prisma: PrismaClient): Promise<void> {
  const BATCH_SIZE = 1000;
  let processed = 0;

  while (true) {
    const batch = await prisma.machine.findMany({
      where: { departmentId: null },
      take: BATCH_SIZE
    });

    if (batch.length === 0) break;

    for (const machine of batch) {
      await prisma.machine.update({
        where: { id: machine.id },
        data: { departmentId: defaultDeptId }
      });
      processed++;
    }

    console.log(`Processed ${processed} machines...`);
  }
}
```

### Handle Edge Cases

```typescript
async up(prisma: PrismaClient): Promise<void> {
  // Check for null values
  const machines = await prisma.machine.findMany({
    where: {
      departmentId: null,
      status: { not: 'deleted' }  // Skip deleted records
    }
  });

  // Handle missing related records
  let defaultDept = await prisma.department.findFirst({
    where: { name: 'Default' }
  });

  if (!defaultDept) {
    defaultDept = await prisma.department.create({
      data: { name: 'Default' }
    });
  }
}
```

### Never Modify Applied Migrations

Once a migration has been applied in production:
- Never modify or delete the migration file
- Create a new migration if you need additional changes
- This ensures consistency across all environments

## Registry

The `registry.json` file tracks which migrations have been applied:

```json
{
  "migrations": [
    {
      "id": "001_populate_department_ids",
      "appliedAt": "2025-01-24T15:30:00Z",
      "executionTimeMs": 1234,
      "status": "success"
    }
  ]
}
```

**Important**:
- Never manually edit this file unless absolutely necessary
- The registry is backed up as part of the system backup process
- Restored automatically during rollback

## Troubleshooting

### Migration Fails

1. Check the error logs for details
2. The update system will automatically roll back to the previous state
3. Fix the migration code and retry the update

### Migration Takes Too Long

1. Check if you're loading too much data into memory
2. Implement batching (see best practices above)
3. Add progress logging to monitor execution
4. Consider optimizing database queries

### Need to Re-run an Applied Migration

**Use with extreme caution**:
1. Manually remove the migration entry from `registry.json`
2. Run the migration again
3. This should only be done if the migration is idempotent

### Migration Works Locally but Fails in Production

1. Check for environment-specific data differences
2. Verify database permissions
3. Check for data volume issues (more records in production)
4. Review error logs in the update output

## Integration with Update System

Data migrations are integrated into the Infinibay update process:

```
./run.sh update
    ├── Backup database and files
    ├── Pull latest code
    ├── npm install
    ├── Build backend
    ├── Run Prisma schema migrations
    ├── Run data migrations  <-- This system
    ├── Build frontend
    └── Verify and restart services
```

If any step fails (including data migrations), the entire update rolls back to the backup state.

See `lxd/UPDATE_SYSTEM_DESIGN.md` for complete update system documentation.
