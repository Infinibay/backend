/**
 * Test the backend duplicate prevention in NetworkFilterService
 * This test simulates the scenario that was causing the unique constraint violation
 */

const { PrismaClient } = require('@prisma/client');
const { NetworkFilterService } = require('../dist/app/services/networkFilterService');

async function testDuplicatePreventionBackend() {
  const prisma = new PrismaClient();
  const networkFilterService = new NetworkFilterService(prisma);

  try {
    console.log('=== TESTING BACKEND DUPLICATE PREVENTION ===\n');

    // First, let's see what filters currently exist
    console.log('1. Checking existing filters in database...');
    const existingFilters = await prisma.nWFilter.findMany({
      where: { name: { contains: 'Developers' } },
      select: { id: true, name: true, type: true, description: true }
    });
    console.log('Found existing Developers filters:', existingFilters);

    // Test 1: Try to create a new filter (this should work)
    console.log('\n2. Creating first filter...');
    const firstFilter = await networkFilterService.createFilter(
      'Test-Developers-Unique-' + Date.now(),
      'Test filter for duplicate prevention',
      'root',
      'department'
    );
    console.log('✅ First filter created:', { id: firstFilter.id, name: firstFilter.name });

    // Test 2: Try to create the exact same filter (this should return existing one)
    console.log('\n3. Attempting to create duplicate filter...');
    const duplicateFilter = await networkFilterService.createFilter(
      firstFilter.name, // Same name
      'Duplicate test description',
      'root',
      'department'
    );

    console.log('✅ Duplicate creation result:', {
      id: duplicateFilter.id,
      name: duplicateFilter.name,
      description: duplicateFilter.description
    });

    // Check if it's the same filter (no duplicate created)
    if (firstFilter.id === duplicateFilter.id) {
      console.log('✅ SUCCESS: Returned existing filter instead of creating duplicate');
      console.log('   - Same ID:', firstFilter.id === duplicateFilter.id);
      console.log('   - Original description:', firstFilter.description);
      console.log('   - Returned description:', duplicateFilter.description);
      console.log('   - Description preserved from original');
    } else {
      console.log('❌ FAILURE: Created a duplicate filter');
    }

    // Test 3: Test the user's actual scenario
    console.log('\n4. Testing user scenario (Developers-default)...');

    // Try to create "Developers-default" twice
    const devFilter1 = await networkFilterService.createFilter(
      'Developers-default-test-' + Date.now(),
      'Default firewall filter for Developers department',
      'root',
      'department'
    );
    console.log('First Developers-default:', { id: devFilter1.id, name: devFilter1.name });

    const devFilter2 = await networkFilterService.createFilter(
      devFilter1.name, // Same name as first
      'Different description',
      'root',
      'department'
    );
    console.log('Second Developers-default:', { id: devFilter2.id, name: devFilter2.name });

    if (devFilter1.id === devFilter2.id) {
      console.log('✅ SUCCESS: User scenario fixed - no unique constraint violation');
    } else {
      console.log('❌ FAILURE: User scenario still broken');
    }

    // Cleanup test filters
    console.log('\n5. Cleaning up test filters...');
    await prisma.nWFilter.deleteMany({
      where: {
        name: {
          in: [firstFilter.name, devFilter1.name]
        }
      }
    });
    console.log('✅ Test filters cleaned up');

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

testDuplicatePreventionBackend();