/**
 * Cleanup script to deduplicate all firewall rules
 * 
 * This script finds and removes duplicate rules in all network filters.
 * It's intended to be run as a one-time cleanup operation.
 */
import { PrismaClient } from '@prisma/client';
import { NetworkFilterService } from '../../app/services/networkFilterService';

const prisma = new PrismaClient();
const networkFilterService = new NetworkFilterService(prisma);

async function cleanupDuplicateRules() {
  console.log('Starting duplicate rules cleanup...');
  
  // Get all filters
  const filters = await prisma.nWFilter.findMany();
  console.log(`Found ${filters.length} network filters to check`);
  
  let totalDuplicatesRemoved = 0;
  
  // Process each filter
  for (const filter of filters) {
    try {
      console.log(`Processing filter: ${filter.name} (${filter.id})...`);
      const removedCount = await networkFilterService.deduplicateRules(filter.id);
      
      if (removedCount > 0) {
        console.log(`  - Removed ${removedCount} duplicate rules`);
        totalDuplicatesRemoved += removedCount;
      } else {
        console.log('  - No duplicates found');
      }
    } catch (error) {
      console.error(`Error processing filter ${filter.id}:`, error);
    }
  }
  
  console.log(`\nDeduplication complete. Removed ${totalDuplicatesRemoved} duplicate rules.`);
}

// Run the cleanup
cleanupDuplicateRules()
  .catch(err => {
    console.error('Error running cleanup script:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
