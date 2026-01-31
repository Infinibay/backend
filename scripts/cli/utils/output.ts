/**
 * CLI output utilities
 */

export const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
}

export function success(msg: string): void {
  console.log(`${colors.green}✓${colors.reset} ${msg}`)
}

export function error(msg: string): void {
  console.error(`${colors.red}✗${colors.reset} ${msg}`)
}

export function warn(msg: string): void {
  console.log(`${colors.yellow}⚠${colors.reset} ${msg}`)
}

export function info(msg: string): void {
  console.log(`${colors.blue}ℹ${colors.reset} ${msg}`)
}

export function heading(msg: string): void {
  console.log(`\n${colors.bright}${msg}${colors.reset}`)
}

export function table(headers: string[], rows: string[][]): void {
  // Calculate column widths
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] || '').length))
  )

  // Print header
  console.log(headers.map((h, i) => h.padEnd(widths[i])).join('  '))
  console.log(widths.map(w => '-'.repeat(w)).join('  '))

  // Print rows
  for (const row of rows) {
    console.log(row.map((c, i) => (c || '').padEnd(widths[i])).join('  '))
  }
}
