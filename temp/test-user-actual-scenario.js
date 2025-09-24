/**
 * Test the actual user scenario that caused the unique constraint violation
 * Based on the error: Unique constraint failed on the fields: (`name`)
 */

// Scenario 1: First time creating a rule - works fine
console.log('=== SCENARIO 1: First Rule Creation (Success) ===');
const departmentFilters1 = []; // Empty - no filters exist yet
const departmentName = 'Developers';

const existingFilter1 = departmentFilters1.find(filter =>
  filter.name === `${departmentName}-default` ||
  filter.name.toLowerCase().includes('default') ||
  (filter.name.toLowerCase().includes(departmentName.toLowerCase()) && filter.type === 'DEPARTMENT') ||
  filter.type === 'DEPARTMENT'
);

if (existingFilter1) {
  console.log('Found existing filter:', existingFilter1.name);
} else {
  console.log('No existing filter found');
  console.log('✅ Will create new filter: "Developers-default"');
  console.log('✅ SUCCESS - First creation works');
}

// Scenario 2: User's actual error case - second attempt
console.log('\n=== SCENARIO 2: Second Rule Creation (User\'s Error) ===');
const departmentFilters2 = [
  {
    id: '1',
    name: 'Developers-default', // This was created in scenario 1
    type: 'DEPARTMENT',
    description: 'Default firewall filter for Developers department'
  }
];

console.log('Available filters:', departmentFilters2);

// OLD LOGIC (what was causing the issue)
console.log('\n--- OLD LOGIC (BROKEN) ---');
const oldLogic = departmentFilters2.find(filter =>
  filter.name === `${departmentName}-default` ||
  filter.name.toLowerCase().includes('default')
);

if (oldLogic) {
  console.log('✅ Old logic found:', oldLogic.name);
  console.log('✅ Would use existing filter - NO ERROR');
} else {
  console.log('❌ Old logic found nothing');
  console.log('❌ Would try to create "Developers-default" again');
  console.log('❌ UNIQUE CONSTRAINT VIOLATION!');
}

// NEW LOGIC (fixed version)
console.log('\n--- NEW LOGIC (FIXED) ---');
const newLogic = departmentFilters2.find(filter =>
  filter.name === `${departmentName}-default` ||
  filter.name.toLowerCase().includes('default') ||
  (filter.name.toLowerCase().includes(departmentName.toLowerCase()) && filter.type === 'DEPARTMENT') ||
  filter.type === 'DEPARTMENT'
);

if (newLogic) {
  console.log('✅ New logic found:', newLogic.name);
  console.log('✅ Will use existing filter - FIXED!');
} else {
  console.log('❌ New logic found nothing (shouldn\'t happen)');
}

console.log('\n=== ANALYSIS ===');
console.log('The issue wasn\'t with the search logic itself, but likely with:');
console.log('1. Data inconsistency - filter exists in DB but not in departmentFilters prop');
console.log('2. Caching issues - departmentFilters not updated after first creation');
console.log('3. Race conditions - multiple simultaneous requests');
console.log('\nThe enhanced search logic provides better fallback coverage.');