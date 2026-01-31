# Creating Packages for Infinibay

This guide explains how to create plugin packages that extend Infinibay with custom health checkers, diagnostics, and remediation actions.

## Table of Contents

1. [Overview](#overview)
2. [Package Types](#package-types)
3. [Package Structure](#package-structure)
4. [The Manifest File](#the-manifest-file)
5. [Creating Checkers](#creating-checkers)
6. [Data Needs](#data-needs)
7. [Capabilities](#capabilities)
8. [Settings](#settings)
9. [Remediations](#remediations)
10. [Testing Your Package](#testing-your-package)
11. [Packaging and Distribution](#packaging-and-distribution)
12. [Best Practices](#best-practices)

---

## Overview

Infinibay's package system allows you to extend the platform with:

- **Health Checkers**: Analyze VM metrics and generate recommendations
- **Remediations**: Scripts that fix issues detected by checkers
- **Custom Settings**: Configuration options for administrators

Packages can be:
- **Built-in**: Included in the Infinibay repository (open-source)
- **External**: Installed via CLI, can be commercial

---

## Package Types

### Built-in Packages

Located in `backend/app/packages/`. These are:
- Loaded directly into the main process
- Trusted and have full access
- Cannot be disabled by users

### External Packages

Located in `/var/infinibay/packages/`. These are:
- Installed via CLI
- Run in isolated worker processes
- Can be enabled/disabled
- Support commercial licensing

---

## Package Structure

```
my-package/
├── manifest.json           # Required - Package metadata
├── checkers/
│   └── my-checker.js       # Checker implementations
├── remediations/           # Optional
│   ├── fix-windows.ps1     # PowerShell scripts
│   └── fix-linux.sh        # Bash scripts
└── README.md               # Optional but recommended
```

### Minimal Example

```
core-diagnostics/
├── manifest.json
└── checkers/
    └── disk-space.js
```

---

## The Manifest File

Every package must have a `manifest.json` at its root.

### Required Fields

```json
{
  "name": "my-package",
  "version": "1.0.0",
  "displayName": "My Package",
  "author": "Your Name",
  "license": "open-source",
  "checkers": []
}
```

### Complete Example

```json
{
  "name": "ai-diagnostics",
  "version": "1.0.0",
  "displayName": "AI-Powered Diagnostics",
  "description": "Uses machine learning to predict disk failures",
  "author": "Infinibay",
  "license": "commercial",
  "minInfinibayVersion": "2.0.0",

  "capabilities": {
    "network": ["api.openai.com"],
    "storage": true,
    "cron": "0 */6 * * *"
  },

  "checkers": [
    {
      "name": "predictive-disk-failure",
      "file": "checkers/disk-predictor.js",
      "type": "PREDICTIVE_DISK_FAILURE",
      "dataNeeds": ["diskMetrics", "diskHealth", "historicalMetrics"]
    }
  ],

  "remediations": [
    {
      "name": "backup-critical-files",
      "script": "remediations/backup.ps1",
      "platforms": ["windows"]
    }
  ],

  "settings": {
    "api_key": {
      "type": "secret",
      "label": "API Key",
      "required": true
    },
    "threshold": {
      "type": "number",
      "label": "Alert Threshold (%)",
      "default": 80
    }
  }
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique identifier (lowercase, alphanumeric, dashes) |
| `version` | string | Yes | Semantic version (e.g., "1.0.0") |
| `displayName` | string | Yes | Human-readable name |
| `description` | string | No | Short description |
| `author` | string | Yes | Author or organization |
| `license` | string | Yes | "open-source" or "commercial" |
| `minInfinibayVersion` | string | No | Minimum compatible version |
| `capabilities` | object | No | Required permissions |
| `checkers` | array | Yes | List of checker definitions |
| `remediations` | array | No | List of remediation scripts |
| `settings` | object | No | Configurable settings |

---

## Creating Checkers

Checkers analyze VM data and return recommendations.

### Checker Interface

```javascript
/**
 * @param {PackageCheckerContext} context - VM data and settings
 * @returns {Promise<PackageCheckerResult[]>} - Array of recommendations
 */
async function analyze(context) {
  // Your analysis logic here
  return [
    {
      type: 'MY_RECOMMENDATION_TYPE',
      text: 'Human-readable description of the issue',
      actionText: 'What the user should do',
      severity: 'medium', // 'low' | 'medium' | 'high' | 'critical'
      data: { /* optional additional data */ }
    }
  ]
}
```

### Complete Checker Example

```javascript
// checkers/disk-space.js

class DiskSpaceChecker {
  async analyze(context) {
    const results = []
    const threshold = context.settings?.threshold || 85

    // Check disk metrics if available
    if (!context.diskMetrics) {
      return results
    }

    for (const disk of context.diskMetrics) {
      const usagePercent = (disk.usedGB / disk.totalGB) * 100

      if (usagePercent >= threshold) {
        results.push({
          type: 'DISK_SPACE_LOW',
          text: `Drive ${disk.drive} is ${usagePercent.toFixed(1)}% full`,
          actionText: 'Free up disk space or expand storage',
          severity: usagePercent >= 95 ? 'critical' : 'high',
          data: {
            drive: disk.drive,
            usedGB: disk.usedGB,
            totalGB: disk.totalGB,
            usagePercent
          }
        })
      }
    }

    return results
  }
}

module.exports = DiskSpaceChecker
```

### Checker Context

The `context` object passed to `analyze()` contains:

```typescript
interface PackageCheckerContext {
  vmId: string                      // ID of the VM being analyzed
  diskMetrics?: DiskMetric[]        // Disk space information
  diskHealth?: DiskHealthInfo       // S.M.A.R.T. data
  historicalMetrics?: Metric[]      // Past performance data
  processSnapshots?: Process[]      // Running processes
  portUsage?: PortInfo[]            // Network ports in use
  machineConfig?: MachineConfig     // VM configuration
  windowsUpdate?: UpdateInfo        // Windows Update status
  defenderStatus?: DefenderInfo     // Windows Defender status
  applicationInventory?: App[]      // Installed applications
  settings: Record<string, unknown> // Package settings from admin
}
```

---

## Data Needs

Specify what data your checker requires in the manifest:

```json
{
  "checkers": [
    {
      "name": "my-checker",
      "file": "checkers/my-checker.js",
      "type": "MY_TYPE",
      "dataNeeds": ["diskMetrics", "historicalMetrics"]
    }
  ]
}
```

### Available Data Types

| Data Need | Description | Platform |
|-----------|-------------|----------|
| `diskMetrics` | Disk space usage per drive | All |
| `diskHealth` | S.M.A.R.T. health data | All |
| `historicalMetrics` | CPU/RAM history (last 24h) | All |
| `processSnapshots` | Running processes | All |
| `portUsage` | Open network ports | All |
| `machineConfig` | VM CPU/RAM/disk config | All |
| `windowsUpdate` | Update status | Windows |
| `defenderStatus` | Defender status | Windows |
| `applicationInventory` | Installed apps | All |

---

## Capabilities

External packages must declare capabilities they need:

```json
{
  "capabilities": {
    "network": ["api.openai.com", "*.azure.com"],
    "storage": true,
    "cron": "0 */6 * * *",
    "remediation": true
  }
}
```

### Capability Reference

| Capability | Type | Description | Risk Level |
|------------|------|-------------|------------|
| `network` | string[] | Allowed domains for HTTP requests | Medium |
| `storage` | boolean | Persist data locally | Low |
| `cron` | string | Schedule own execution (cron format) | Low |
| `remediation` | boolean | Execute scripts on VMs | High |

Administrators are prompted to approve capabilities during installation.

---

## Settings

Define configurable options that administrators can set:

```json
{
  "settings": {
    "api_key": {
      "type": "secret",
      "label": "API Key",
      "description": "Your OpenAI API key",
      "required": true
    },
    "threshold": {
      "type": "number",
      "label": "Alert Threshold",
      "default": 80
    },
    "mode": {
      "type": "select",
      "label": "Analysis Mode",
      "options": [
        { "value": "quick", "label": "Quick Scan" },
        { "value": "deep", "label": "Deep Analysis" }
      ],
      "default": "quick"
    }
  }
}
```

### Setting Types

| Type | Description |
|------|-------------|
| `string` | Text input |
| `number` | Numeric input |
| `boolean` | Toggle switch |
| `secret` | Password/API key (masked) |
| `select` | Dropdown with options |

Settings are passed to your checker via `context.settings`:

```javascript
async analyze(context) {
  const apiKey = context.settings.api_key
  const threshold = context.settings.threshold || 80
  // ...
}
```

---

## Remediations

Provide scripts that fix issues:

```json
{
  "remediations": [
    {
      "name": "cleanup-temp-files",
      "script": "remediations/cleanup.ps1",
      "platforms": ["windows"]
    },
    {
      "name": "cleanup-temp-files",
      "script": "remediations/cleanup.sh",
      "platforms": ["linux"]
    }
  ]
}
```

### Linking to Checkers

Reference remediations in checker results:

```javascript
{
  type: 'DISK_SPACE_LOW',
  text: 'Drive C: is 95% full',
  actionText: 'Run cleanup to free space',
  severity: 'high',
  remediation: 'cleanup-temp-files'  // Name from manifest
}
```

---

## Testing Your Package

### 1. Validate Manifest

```bash
# The CLI validates manifests during installation
infinibay package install ./my-package.tar.gz

# Or validate manually
node -e "
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync('./manifest.json'));
console.log('Name:', manifest.name);
console.log('Checkers:', manifest.checkers.length);
"
```

### 2. Test Checker Logic

```javascript
// test/my-checker.test.js
const MyChecker = require('../checkers/my-checker')

describe('MyChecker', () => {
  it('should detect low disk space', async () => {
    const checker = new MyChecker()
    const context = {
      vmId: 'test-vm',
      diskMetrics: [
        { drive: 'C:', usedGB: 95, totalGB: 100 }
      ],
      settings: { threshold: 85 }
    }

    const results = await checker.analyze(context)

    expect(results).toHaveLength(1)
    expect(results[0].type).toBe('DISK_SPACE_LOW')
    expect(results[0].severity).toBe('critical')
  })
})
```

### 3. Test as Built-in

During development, place your package in `backend/app/packages/`:

```bash
cp -r my-package backend/app/packages/
npm run dev
# Check backend logs for loading status
```

---

## Packaging and Distribution

### Create Distribution Package

```bash
cd my-package
tar -czvf ../my-package-1.0.0.tar.gz .
```

### Install Package

```bash
infinibay package install ./my-package-1.0.0.tar.gz
```

### Package Commands

```bash
# List installed packages
infinibay package list

# Show package details
infinibay package info my-package

# Enable/disable
infinibay package enable my-package
infinibay package disable my-package

# Uninstall
infinibay package uninstall my-package
```

### Commercial Licenses

For commercial packages, users must activate a license:

```bash
infinibay package license activate my-package XXXX-XXXX-XXXX-XXXX
```

---

## Best Practices

### 1. Handle Missing Data Gracefully

```javascript
async analyze(context) {
  // Always check if data exists
  if (!context.diskMetrics || context.diskMetrics.length === 0) {
    return []
  }
  // ...
}
```

### 2. Use Appropriate Severity Levels

| Severity | When to Use |
|----------|-------------|
| `low` | Informational, optimization suggestions |
| `medium` | Should be addressed but not urgent |
| `high` | Needs attention soon |
| `critical` | Immediate action required |

### 3. Provide Actionable Recommendations

```javascript
// Bad
{ text: 'Disk is full' }

// Good
{
  text: 'Drive C: is 95% full (47.5 GB free of 500 GB)',
  actionText: 'Delete temporary files or move data to another drive'
}
```

### 4. Include Relevant Data

```javascript
{
  type: 'DISK_SPACE_LOW',
  text: 'Drive C: is 95% full',
  actionText: 'Free up space',
  severity: 'critical',
  data: {
    drive: 'C:',
    usedGB: 475,
    totalGB: 500,
    usagePercent: 95,
    largestFolders: ['Windows', 'Users', 'Program Files']
  }
}
```

### 5. Respect Settings

```javascript
const threshold = context.settings?.threshold ?? 85  // Default to 85
const enabled = context.settings?.enabled !== false  // Default to true
```

### 6. Log Appropriately

For external packages, use console for debugging:

```javascript
if (process.env.DEBUG) {
  console.log('[my-package] Analyzing VM:', context.vmId)
}
```

---

## Reference

### File Locations

| Type | Location |
|------|----------|
| Built-in packages | `backend/app/packages/` |
| External packages | `/var/infinibay/packages/` |
| Package types | `backend/app/services/packages/types.ts` |
| Package manager | `backend/app/services/packages/PackageManager.ts` |

### Example Package

See `backend/app/packages/core-diagnostics/` for a complete working example.

### TypeScript Interfaces

```typescript
// From backend/app/services/packages/types.ts

interface PackageCheckerResult {
  type: string
  text: string
  actionText: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  data?: Record<string, unknown>
  remediation?: string
}

interface PackageCheckerContext {
  vmId: string
  diskMetrics?: unknown
  diskHealth?: unknown
  historicalMetrics?: unknown[]
  processSnapshots?: unknown[]
  portUsage?: unknown[]
  machineConfig?: unknown
  windowsUpdate?: unknown
  defenderStatus?: unknown
  applicationInventory?: unknown
  settings: Record<string, unknown>
}
```

---

## Getting Help

- Check existing packages in `backend/app/packages/` for examples
- Review `PackageManager.ts` for loading logic
- See `types.ts` for all TypeScript interfaces
- Open an issue on GitHub for support
