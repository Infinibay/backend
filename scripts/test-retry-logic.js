#!/usr/bin/env node

// Script to demonstrate the new retry logic for VM health checks
// This shows how the backoff timing works for VM startup scenarios

const DEFAULT_MAX_ATTEMPTS = 20;
const INITIAL_BACKOFF_MS = 30000; // 30 seconds
const MAX_BACKOFF_MS = 300000; // 5 minutes
const BACKOFF_MULTIPLIER = 1.5;

function calculateBackoff(attempt, isConnectionError = true) {
  const baseBackoff = isConnectionError ? INITIAL_BACKOFF_MS : 10000;
  return Math.min(
    baseBackoff * Math.pow(BACKOFF_MULTIPLIER, attempt - 1),
    MAX_BACKOFF_MS
  );
}

function formatTime(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

console.log('🗂️ VM Health Check Retry Logic Demonstration');
console.log('='.repeat(50));
console.log(`Max attempts: ${DEFAULT_MAX_ATTEMPTS}`);
console.log(`Initial backoff: ${formatTime(INITIAL_BACKOFF_MS)}`);
console.log(`Max backoff: ${formatTime(MAX_BACKOFF_MS)}`);
console.log(`Backoff multiplier: ${BACKOFF_MULTIPLIER}x`);
console.log('');

console.log('📊 Connection Error Backoff Schedule (VM/InfiniService starting up):');
let totalTime = 0;
for (let attempt = 1; attempt <= DEFAULT_MAX_ATTEMPTS; attempt++) {
  const backoffMs = calculateBackoff(attempt, true);
  totalTime += backoffMs;
  
  console.log(`  Attempt ${attempt.toString().padStart(2)}: Wait ${formatTime(backoffMs).padStart(8)} | Total time: ${formatTime(totalTime)}`);
  
  if (attempt === 10) {
    console.log('  ... (showing first 10 attempts)');
    break;
  }
}

console.log('');
console.log('📊 Other Error Backoff Schedule (faster retry):');
totalTime = 0;
for (let attempt = 1; attempt <= 10; attempt++) {
  const backoffMs = calculateBackoff(attempt, false);
  totalTime += backoffMs;
  
  console.log(`  Attempt ${attempt.toString().padStart(2)}: Wait ${formatTime(backoffMs).padStart(8)} | Total time: ${formatTime(totalTime)}`);
}

console.log('');
console.log('💡 Key Benefits:');
console.log('  • 20 attempts instead of 3 (much more patient for VM startup)');
console.log('  • Starts with 30s delay (gives OS time to boot)');
console.log('  • Gentler exponential growth (1.5x vs 2x)');
console.log('  • Caps at 5 minutes (prevents excessive delays)');
console.log('  • Different timing for connection vs other errors');
console.log('  • Total retry window: ~45 minutes for connection errors');
