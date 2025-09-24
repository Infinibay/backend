/**
 * Test script to validate the enhanced filter search logic
 * This simulates the scenario where multiple filters exist for a department
 */

// Mock data representing the departmentFilters that would be passed to the wizard
const departmentFilters = [
  {
    id: '1',
    name: 'Filter for department Developers',
    type: 'DEPARTMENT',
    description: 'Existing filter'
  },
  {
    id: '2',
    name: 'Developers-default',
    type: 'DEPARTMENT',
    description: 'Default filter'
  },
  {
    id: '3',
    name: 'Some other filter',
    type: 'VM',
    description: 'VM filter'
  },
  {
    id: '4',
    name: 'Marketing-default',
    type: 'DEPARTMENT',
    description: 'Marketing department filter'
  }
];

const departmentName = 'Developers';

// This is the enhanced search logic from the wizard
const existingFilter = departmentFilters.find(filter =>
  // First try to find by expected name
  filter.name === `${departmentName}-default` ||
  // Then try filters that include 'default' in the name
  filter.name.toLowerCase().includes('default') ||
  // Also try filters that include the department name and are DEPARTMENT type
  (filter.name.toLowerCase().includes(departmentName.toLowerCase()) && filter.type === 'DEPARTMENT') ||
  // Finally, any DEPARTMENT type filter (as fallback)
  filter.type === 'DEPARTMENT'
);

console.log('Testing enhanced filter search logic');
console.log('Department name:', departmentName);
console.log('Available filters:', departmentFilters.map(f => ({ id: f.id, name: f.name, type: f.type })));
console.log('Found existing filter:', existingFilter);

if (existingFilter) {
  console.log('\n✅ SUCCESS: Found existing filter with ID:', existingFilter.id);
  console.log('   Filter name:', existingFilter.name);
  console.log('   This should prevent creating a duplicate filter');
} else {
  console.log('\n❌ FAILURE: No existing filter found, would attempt to create new one');
}

// Test individual conditions
console.log('\n--- Testing individual search conditions ---');
console.log('Condition 1 - Exact match `Developers-default`:',
  departmentFilters.some(f => f.name === `${departmentName}-default`));
console.log('Condition 2 - Contains "default":',
  departmentFilters.some(f => f.name.toLowerCase().includes('default')));
console.log('Condition 3 - Contains department name + DEPARTMENT type:',
  departmentFilters.some(f => f.name.toLowerCase().includes(departmentName.toLowerCase()) && f.type === 'DEPARTMENT'));
console.log('Condition 4 - Any DEPARTMENT type:',
  departmentFilters.some(f => f.type === 'DEPARTMENT'));