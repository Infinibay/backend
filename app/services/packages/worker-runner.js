#!/usr/bin/env node

/**
 * Worker Runner - Executes external packages in isolated process
 *
 * Communication: JSON-RPC 2.0 over stdio
 * - Reads requests from stdin (newline-delimited JSON)
 * - Writes responses to stdout (newline-delimited JSON)
 */

const fs = require('fs')
const path = require('path')
const readline = require('readline')

// Get package path from command line or environment
const packagePath = process.argv[2] || process.env.PACKAGE_PATH

if (!packagePath) {
  console.error('Error: Package path not provided')
  process.exit(1)
}

// State
let manifest = null
let checkers = new Map()
let settings = {}
let isShuttingDown = false

/**
 * Load the package
 */
function loadPackage() {
  const manifestPath = path.join(packagePath, 'manifest.json')

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`)
  }

  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

  // Load checkers
  for (const checkerDef of manifest.checkers || []) {
    const checkerPath = path.join(packagePath, checkerDef.file)

    if (!fs.existsSync(checkerPath)) {
      console.error(`Checker not found: ${checkerPath}`)
      continue
    }

    try {
      const checkerModule = require(checkerPath)
      const CheckerClass =
        checkerModule.default || checkerModule[Object.keys(checkerModule)[0]]

      let checker
      if (typeof CheckerClass === 'function') {
        checker = new CheckerClass()
      } else if (typeof CheckerClass.analyze === 'function') {
        checker = CheckerClass
      } else {
        console.error(`Invalid checker export: ${checkerDef.name}`)
        continue
      }

      checkers.set(checkerDef.name, {
        definition: checkerDef,
        instance: checker,
      })
    } catch (error) {
      console.error(`Failed to load checker ${checkerDef.name}: ${error.message}`)
    }
  }

  return manifest
}

/**
 * Handle JSON-RPC request
 */
async function handleRequest(request) {
  const { id, method, params } = request

  try {
    let result

    switch (method) {
      case 'analyze':
        result = await handleAnalyze(params)
        break

      case 'configure':
        result = await handleConfigure(params)
        break

      case 'health':
        result = await handleHealth()
        break

      case 'shutdown':
        result = await handleShutdown()
        break

      default:
        throw { code: -32601, message: `Method not found: ${method}` }
    }

    return {
      jsonrpc: '2.0',
      id,
      result,
    }
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: error.code || -32603,
        message: error.message || 'Internal error',
        data: error.data,
      },
    }
  }
}

/**
 * Handle analyze request - run all checkers
 */
async function handleAnalyze(params) {
  const { context } = params
  const recommendations = []

  // Add settings to context
  const contextWithSettings = {
    ...context,
    settings,
  }

  // Run each checker
  for (const [name, checker] of checkers) {
    try {
      const results = await checker.instance.analyze(contextWithSettings)

      if (Array.isArray(results)) {
        for (const result of results) {
          recommendations.push({
            ...result,
            _checkerName: name,
            _packageName: manifest.name,
          })
        }
      }
    } catch (error) {
      console.error(`Checker ${name} failed: ${error.message}`)
    }
  }

  return { recommendations }
}

/**
 * Handle configure request - update settings
 */
async function handleConfigure(params) {
  const { settings: newSettings } = params
  settings = { ...settings, ...newSettings }
  return { success: true }
}

/**
 * Handle health check
 */
async function handleHealth() {
  return {
    healthy: true,
    packageName: manifest?.name,
    checkerCount: checkers.size,
    uptime: process.uptime(),
  }
}

/**
 * Handle shutdown request
 */
async function handleShutdown() {
  isShuttingDown = true

  // Allow response to be sent before exiting
  setTimeout(() => {
    process.exit(0)
  }, 100)

  return { success: true }
}

/**
 * Send response to stdout
 */
function sendResponse(response) {
  process.stdout.write(JSON.stringify(response) + '\n')
}

/**
 * Main entry point
 */
async function main() {
  try {
    // Load the package
    loadPackage()

    // Signal ready
    sendResponse({ ready: true, packageName: manifest.name })

    // Set up stdin reader
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    })

    rl.on('line', async (line) => {
      if (isShuttingDown) return

      try {
        const request = JSON.parse(line)
        const response = await handleRequest(request)
        sendResponse(response)
      } catch (error) {
        sendResponse({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error',
            data: error.message,
          },
        })
      }
    })

    rl.on('close', () => {
      if (!isShuttingDown) {
        process.exit(0)
      }
    })

    // Handle signals
    process.on('SIGTERM', () => {
      isShuttingDown = true
      process.exit(0)
    })

    process.on('SIGINT', () => {
      isShuttingDown = true
      process.exit(0)
    })
  } catch (error) {
    console.error(`Worker initialization failed: ${error.message}`)
    process.exit(1)
  }
}

main()
