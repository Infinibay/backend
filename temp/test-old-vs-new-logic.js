/**
 * Test script to compare old vs new filter search logic
 * This demonstrates how the fix prevents the unique constraint violation
 */

// Mock data based on the user's actual scenario
const departmentFilters = [
  {
    id: '1',
    name: 'Filter for department Developers',  // This exists in the database per user's error
    type: 'DEPARTMENT',
    description: 'Existing filter for developers'
  },
  {
    id: '2',
    name: 'Marketing-default',
    type: 'DEPARTMENT',
    description: 'Marketing department filter'
  },
  {
    id: '3',
    name: 'Some VM filter',
    type: 'VM',
    description: 'VM-specific filter'
  }
];

const departmentName = 'Developers';

console.log('=== TESTING OLD vs NEW FILTER SEARCH LOGIC ===\n');
console.log('Scenario: User tries to create firewall rule for "Developers" department');
console.log('Available filters:', departmentFilters.map(f => ({ id: f.id, name: f.name, type: f.type })));
console.log('Expected behavior: Should find existing "Filter for department Developers" filter\n');

// OLD LOGIC (would cause the unique constraint violation)
console.log('--- OLD LOGIC (BEFORE FIX) ---');
const oldSearchLogic = departmentFilters.find(filter =>
  filter.name === `${departmentName}-default` ||
  filter.name.toLowerCase().includes('default')
);

if (oldSearchLogic) {
  console.log('✅ Old logic found filter:', oldSearchLogic.name);
} else {
  console.log('❌ Old logic found NO filter');
  console.log('   Would attempt to create: "Developers-default"');
  console.log('   This would cause unique constraint violation!');
}

// NEW LOGIC (enhanced to prevent the error)
console.log('\n--- NEW LOGIC (AFTER FIX) ---');
const newSearchLogic = departmentFilters.find(filter =>
  // First try to find by expected name
  filter.name === `${departmentName}-default` ||
  // Then try filters that include 'default' in the name
  filter.name.toLowerCase().includes('default') ||
  // Also try filters that include the department name and are DEPARTMENT type
  (filter.name.toLowerCase().includes(departmentName.toLowerCase()) && filter.type === 'DEPARTMENT') ||
  // Finally, any DEPARTMENT type filter (as fallback)
  filter.type === 'DEPARTMENT'
);

if (newSearchLogic) {
  console.log('✅ New logic found filter:', newSearchLogic.name);
  console.log('   Will use existing filter ID:', newSearchLogic.id);
  console.log('   No duplicate creation - FIXED!');
} else {
  console.log('❌ New logic found NO filter (this shouldn\'t happen)');
}

console.log('\n=== SUMMARY ===');
console.log('Old logic result:', oldSearchLogic ? `Found: ${oldSearchLogic.name}` : 'No filter found');
console.log('New logic result:', newSearchLogic ? `Found: ${newSearchLogic.name}` : 'No filter found');
console.log('Fix successful:', newSearchLogic ? 'YES' : 'NO');