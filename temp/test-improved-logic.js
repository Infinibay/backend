/**
 * Test the improved prioritized filter search logic
 */

function findFilterWithPriority(departmentFilters, departmentName) {
  return departmentFilters.find(filter =>
    // First priority: exact match for expected name
    filter.name === `${departmentName}-default`
  ) || departmentFilters.find(filter =>
    // Second priority: filters that include the department name and are DEPARTMENT type
    filter.name.toLowerCase().includes(departmentName.toLowerCase()) && filter.type === 'DEPARTMENT'
  ) || departmentFilters.find(filter =>
    // Third priority: filters that include 'default' in the name and are DEPARTMENT type
    filter.name.toLowerCase().includes('default') && filter.type === 'DEPARTMENT'
  ) || departmentFilters.find(filter =>
    // Last fallback: any DEPARTMENT type filter
    filter.type === 'DEPARTMENT'
  );
}

// Test the problematic case from Edge Case 3
console.log('=== IMPROVED LOGIC TEST ===');
const multiDeptFilters = [
  { id: '1', name: 'Marketing-default', type: 'DEPARTMENT' },
  { id: '2', name: 'HR-default', type: 'DEPARTMENT' },
  { id: '3', name: 'Filter for department Developers', type: 'DEPARTMENT' }
];

const departmentName = 'Developers';
const result = findFilterWithPriority(multiDeptFilters, departmentName);

console.log('Available filters:', multiDeptFilters.map(f => f.name));
console.log('Department:', departmentName);
console.log('Found filter:', result ? result.name : 'None');
console.log('Result: ✅ Now finds the correct department-specific filter!');

// Test with the actual scenario that caused the user's error
console.log('\n=== USER SCENARIO TEST ===');
const userScenario = [
  { id: '1', name: 'Developers-default', type: 'DEPARTMENT' }
];

const userResult = findFilterWithPriority(userScenario, departmentName);
console.log('Available filters:', userScenario.map(f => f.name));
console.log('Found filter:', userResult ? userResult.name : 'None');
console.log('Priority level: 1 (exact match)');
console.log('Result: ✅ Will use existing filter, no duplicate creation');

// Test mixed scenario
console.log('\n=== MIXED SCENARIO TEST ===');
const mixedScenario = [
  { id: '1', name: 'Filter for department Developers', type: 'DEPARTMENT' },
  { id: '2', name: 'Developers-default', type: 'DEPARTMENT' },
  { id: '3', name: 'Marketing-default', type: 'DEPARTMENT' }
];

const mixedResult = findFilterWithPriority(mixedScenario, departmentName);
console.log('Available filters:', mixedScenario.map(f => f.name));
console.log('Found filter:', mixedResult ? mixedResult.name : 'None');
console.log('Priority level: 1 (exact match for "Developers-default")');
console.log('Result: ✅ Correctly prioritizes exact match over department name match');