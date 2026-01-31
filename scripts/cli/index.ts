#!/usr/bin/env node
/**
 * Infinibay CLI
 *
 * Usage:
 *   infinibay <command> [options]
 *
 * Commands:
 *   package    Manage extension packages
 *   help       Show this help message
 */

import { handlePackageCommand } from './commands/package'

const args = process.argv.slice(2)
const command = args[0]
const rest = args.slice(1)

async function main(): Promise<void> {
  switch (command) {
    case 'package':
    case 'pkg':
      await handlePackageCommand(rest)
      break

    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printHelp()
      break

    default:
      console.error(`Unknown command: ${command}`)
      printHelp()
      process.exit(1)
  }
}

function printHelp(): void {
  console.log(`
Infinibay CLI

Usage: infinibay <command> [options]

Commands:
  package, pkg    Manage extension packages
  help            Show this help message

Run 'infinibay <command> --help' for more information on a command.
`)
}

main().catch(error => {
  console.error('Error:', error.message)
  process.exit(1)
})
