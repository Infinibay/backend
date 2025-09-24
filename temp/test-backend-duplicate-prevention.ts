/**
 * Test the backend duplicate prevention in NetworkFilterService
 */

import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { NetworkFilterService } from '../app/services/networkFilterService';

async function testDuplicatePreventionBackend() {
  const prisma = new PrismaClient();
  const networkFilterService = new NetworkFilterService(prisma);

  try {
    console.log('=== TESTING BACKEND DUPLICATE PREVENTION ===\n');

    // Test: Try to create the same filter twice
    console.log('1. Creating first filter...');
    const testName = 'Test-Duplicate-Prevention-' + Date.now();

    const firstFilter = await networkFilterService.createFilter(
      testName,
      'Test filter for duplicate prevention',
      'root',
      'department'
    );
    console.log('✅ First filter created:', { id: firstFilter.id, name: firstFilter.name });

    console.log('\n2. Attempting to create duplicate filter with same name...');
    const duplicateFilter = await networkFilterService.createFilter(
      testName, // Same name
      'Different description - should not be created',
      'root',
      'department'
    );

    console.log('Result:', {
      id: duplicateFilter.id,
      name: duplicateFilter.name,
      description: duplicateFilter.description
    });

    // Check if it's the same filter
    if (firstFilter.id === duplicateFilter.id) {
      console.log('✅ SUCCESS: Backend duplicate prevention works!');
      console.log('   - Returned existing filter instead of creating duplicate');
      console.log('   - Original description preserved:', firstFilter.description);
      console.log('   - No unique constraint violation occurred');
    } else {
      console.log('❌ FAILURE: Created a duplicate filter');
    }

    // Cleanup
    await prisma.nWFilter.delete({
      where: { id: firstFilter.id }
    });
    console.log('\n✅ Test filter cleaned up');

  } catch (error: any) {
    console.error('❌ Test failed with error:', error.message);
    if (error.message.includes('Unique constraint')) {
      console.error('🚨 UNIQUE CONSTRAINT VIOLATION - Fix not working!');
    }
  } finally {
    await prisma.$disconnect();
  }
}

testDuplicatePreventionBackend();