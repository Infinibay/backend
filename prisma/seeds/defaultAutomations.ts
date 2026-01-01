/**
 * Default Automations Seed
 *
 * Pre-configured automations that replace the legacy hardcoded checkers.
 * These are enabled by default and run on all VMs.
 */

import { PrismaClient, Prisma, RecommendationType, AutomationScope, AutomationStatus } from '@prisma/client'

interface DefaultAutomation {
  name: string
  description: string
  recommendationType: RecommendationType
  recommendationText: string
  recommendationActionText: string
  priority: number
  cooldownMinutes: number
  blocklyWorkspace: object
  compiledCode: string
}

const defaultAutomations: DefaultAutomation[] = [
  // ═══════════════════════════════════════════════════════════════
  // DISK SPACE
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Disk Space Warning',
    description: 'Alerts when disk usage exceeds 85%',
    recommendationType: 'DISK_SPACE_LOW',
    recommendationText: 'Disk space is running low',
    recommendationActionText: 'Free up space by deleting unnecessary files or expanding the disk',
    priority: 50,
    cooldownMinutes: 60,
    blocklyWorkspace: {
      blocks: {
        languageVersion: 0,
        blocks: [{
          type: 'logic_if_return',
          inputs: {
            CONDITION: {
              block: {
                type: 'compare_number',
                fields: { OP: 'GTE' },
                inputs: {
                  A: { block: { type: 'health_disk_usage_percent', fields: { DRIVE: 'C:' } } },
                  B: { block: { type: 'math_number', fields: { NUM: 85 } } }
                }
              }
            }
          }
        }]
      }
    },
    compiledCode: `function evaluate(context) {
  const diskUsage = context.health?.diskSpaceInfo?.diskUsage || {};
  for (const [drive, usage] of Object.entries(diskUsage)) {
    const used = usage.used || usage.usedGB || 0;
    const total = usage.total || usage.totalGB || 1;
    const percentage = total > 0 ? (used / total) * 100 : 0;
    if (percentage >= 85 && percentage < 95) return true;
  }
  return false;
}`
  },
  {
    name: 'Disk Space Critical',
    description: 'Alerts when disk usage exceeds 95%',
    recommendationType: 'DISK_SPACE_LOW',
    recommendationText: 'Disk space is critically low',
    recommendationActionText: 'Immediately free up space or expand the disk to prevent issues',
    priority: 25,
    cooldownMinutes: 30,
    blocklyWorkspace: {
      blocks: {
        languageVersion: 0,
        blocks: [{
          type: 'logic_if_return',
          inputs: {
            CONDITION: {
              block: {
                type: 'compare_number',
                fields: { OP: 'GTE' },
                inputs: {
                  A: { block: { type: 'health_disk_usage_percent', fields: { DRIVE: 'C:' } } },
                  B: { block: { type: 'math_number', fields: { NUM: 95 } } }
                }
              }
            }
          }
        }]
      }
    },
    compiledCode: `function evaluate(context) {
  const diskUsage = context.health?.diskSpaceInfo?.diskUsage || {};
  for (const [drive, usage] of Object.entries(diskUsage)) {
    const used = usage.used || usage.usedGB || 0;
    const total = usage.total || usage.totalGB || 1;
    const percentage = total > 0 ? (used / total) * 100 : 0;
    if (percentage >= 95) return true;
  }
  return false;
}`
  },

  // ═══════════════════════════════════════════════════════════════
  // RESOURCE OPTIMIZATION
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'High CPU Usage',
    description: 'Alerts on sustained high CPU usage (>85%)',
    recommendationType: 'UNDER_PROVISIONED',
    recommendationText: 'This VM may need more CPU resources',
    recommendationActionText: 'Consider increasing CPU cores to improve performance',
    priority: 60,
    cooldownMinutes: 120,
    blocklyWorkspace: {
      blocks: {
        languageVersion: 0,
        blocks: [{
          type: 'logic_if_return',
          inputs: {
            CONDITION: {
              block: {
                type: 'compare_number',
                fields: { OP: 'GT' },
                inputs: {
                  A: { block: { type: 'health_cpu_usage' } },
                  B: { block: { type: 'math_number', fields: { NUM: 85 } } }
                }
              }
            }
          }
        }]
      }
    },
    compiledCode: `function evaluate(context) {
  const cpuUsage = context.health?.cpuUsagePercent || context.metrics?.cpuUsagePercent || 0;
  return cpuUsage > 85;
}`
  },
  {
    name: 'High Memory Usage',
    description: 'Alerts on high memory usage (>90%)',
    recommendationType: 'UNDER_PROVISIONED',
    recommendationText: 'This VM may need more RAM',
    recommendationActionText: 'Consider adding more memory to improve performance',
    priority: 55,
    cooldownMinutes: 120,
    blocklyWorkspace: {
      blocks: {
        languageVersion: 0,
        blocks: [{
          type: 'logic_if_return',
          inputs: {
            CONDITION: {
              block: {
                type: 'compare_number',
                fields: { OP: 'GT' },
                inputs: {
                  A: { block: { type: 'health_memory_usage' } },
                  B: { block: { type: 'math_number', fields: { NUM: 90 } } }
                }
              }
            }
          }
        }]
      }
    },
    compiledCode: `function evaluate(context) {
  const metrics = context.metrics;
  if (!metrics?.totalMemoryKB || !metrics?.usedMemoryKB) return false;
  const total = typeof metrics.totalMemoryKB === 'bigint' ? Number(metrics.totalMemoryKB) : metrics.totalMemoryKB;
  const used = typeof metrics.usedMemoryKB === 'bigint' ? Number(metrics.usedMemoryKB) : metrics.usedMemoryKB;
  const usage = (used / total) * 100;
  return usage > 90;
}`
  },
  {
    name: 'Under-utilized Resources',
    description: 'Identifies VMs with excess resources (CPU<30%, RAM<40%)',
    recommendationType: 'OVER_PROVISIONED',
    recommendationText: 'This VM has more resources than it needs',
    recommendationActionText: 'Consider reducing allocated resources to optimize utilization',
    priority: 100,
    cooldownMinutes: 1440,
    blocklyWorkspace: {
      blocks: {
        languageVersion: 0,
        blocks: [{
          type: 'logic_if_return',
          inputs: {
            CONDITION: {
              block: {
                type: 'logic_and',
                inputs: {
                  A: {
                    block: {
                      type: 'compare_number',
                      fields: { OP: 'LT' },
                      inputs: {
                        A: { block: { type: 'health_cpu_usage' } },
                        B: { block: { type: 'math_number', fields: { NUM: 30 } } }
                      }
                    }
                  },
                  B: {
                    block: {
                      type: 'compare_number',
                      fields: { OP: 'LT' },
                      inputs: {
                        A: { block: { type: 'health_memory_usage' } },
                        B: { block: { type: 'math_number', fields: { NUM: 40 } } }
                      }
                    }
                  }
                }
              }
            }
          }
        }]
      }
    },
    compiledCode: `function evaluate(context) {
  const cpuUsage = context.health?.cpuUsagePercent || context.metrics?.cpuUsagePercent || 100;
  const metrics = context.metrics;
  if (!metrics?.totalMemoryKB || !metrics?.usedMemoryKB) return false;
  const total = typeof metrics.totalMemoryKB === 'bigint' ? Number(metrics.totalMemoryKB) : metrics.totalMemoryKB;
  const used = typeof metrics.usedMemoryKB === 'bigint' ? Number(metrics.usedMemoryKB) : metrics.usedMemoryKB;
  const memUsage = (used / total) * 100;
  return cpuUsage < 30 && memUsage < 40;
}`
  },

  // ═══════════════════════════════════════════════════════════════
  // SECURITY
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Windows Defender Disabled',
    description: 'Alerts when Windows Defender is disabled',
    recommendationType: 'DEFENDER_DISABLED',
    recommendationText: 'Windows Defender is not protecting this VM',
    recommendationActionText: 'Enable Windows Defender through Windows Security settings',
    priority: 20,
    cooldownMinutes: 60,
    blocklyWorkspace: {
      blocks: {
        languageVersion: 0,
        blocks: [{
          type: 'logic_if_return',
          inputs: {
            CONDITION: {
              block: {
                type: 'logic_not',
                inputs: {
                  VALUE: { block: { type: 'health_defender_enabled' } }
                }
              }
            }
          }
        }]
      }
    },
    compiledCode: `function evaluate(context) {
  const defender = context.health?.defenderStatus;
  if (!defender) return false;
  const data = typeof defender === 'string' ? JSON.parse(defender) : defender;
  return data.enabled === false;
}`
  },
  {
    name: 'Real-time Protection Disabled',
    description: 'Alerts when Defender real-time protection is off',
    recommendationType: 'DEFENDER_DISABLED',
    recommendationText: 'Windows Defender real-time protection is disabled',
    recommendationActionText: 'Enable real-time protection in Virus & threat protection settings',
    priority: 30,
    cooldownMinutes: 60,
    blocklyWorkspace: {
      blocks: {
        languageVersion: 0,
        blocks: [{
          type: 'logic_if_return',
          inputs: {
            CONDITION: {
              block: {
                type: 'logic_and',
                inputs: {
                  A: { block: { type: 'health_defender_enabled' } },
                  B: {
                    block: {
                      type: 'logic_not',
                      inputs: {
                        VALUE: { block: { type: 'health_defender_realtime_enabled' } }
                      }
                    }
                  }
                }
              }
            }
          }
        }]
      }
    },
    compiledCode: `function evaluate(context) {
  const defender = context.health?.defenderStatus;
  if (!defender) return false;
  const data = typeof defender === 'string' ? JSON.parse(defender) : defender;
  return data.enabled === true && data.real_time_protection === false;
}`
  },
  {
    name: 'Threat Detected',
    description: 'Alerts when Windows Defender has detected threats',
    recommendationType: 'DEFENDER_THREAT',
    recommendationText: 'Windows Defender has detected a threat',
    recommendationActionText: 'Review and remove detected threats in Windows Security',
    priority: 10,
    cooldownMinutes: 30,
    blocklyWorkspace: {
      blocks: {
        languageVersion: 0,
        blocks: [{
          type: 'logic_if_return',
          inputs: {
            CONDITION: {
              block: {
                type: 'compare_number',
                fields: { OP: 'GT' },
                inputs: {
                  A: { block: { type: 'health_defender_threats_count' } },
                  B: { block: { type: 'math_number', fields: { NUM: 0 } } }
                }
              }
            }
          }
        }]
      }
    },
    compiledCode: `function evaluate(context) {
  const defender = context.health?.defenderStatus;
  if (!defender) return false;
  const data = typeof defender === 'string' ? JSON.parse(defender) : defender;
  return (data.threats_detected || 0) > 0;
}`
  },

  // ═══════════════════════════════════════════════════════════════
  // UPDATES
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Pending Windows Updates',
    description: 'Alerts when there are pending Windows updates',
    recommendationType: 'OS_UPDATE_AVAILABLE',
    recommendationText: 'Windows updates are available',
    recommendationActionText: 'Install pending updates through Windows Update',
    priority: 70,
    cooldownMinutes: 1440,
    blocklyWorkspace: {
      blocks: {
        languageVersion: 0,
        blocks: [{
          type: 'logic_if_return',
          inputs: {
            CONDITION: {
              block: {
                type: 'compare_number',
                fields: { OP: 'GT' },
                inputs: {
                  A: { block: { type: 'health_updates_pending_count' } },
                  B: { block: { type: 'math_number', fields: { NUM: 0 } } }
                }
              }
            }
          }
        }]
      }
    },
    compiledCode: `function evaluate(context) {
  const updateInfo = context.health?.windowsUpdateInfo;
  if (!updateInfo) return false;
  const data = typeof updateInfo === 'string' ? JSON.parse(updateInfo) : updateInfo;
  const count = data.pending_updates_count || data.pendingUpdatesCount || 0;
  return count > 0;
}`
  },

  // ═══════════════════════════════════════════════════════════════
  // NETWORK
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Blocked Connections',
    description: 'Alerts when firewall is blocking application connections',
    recommendationType: 'PORT_BLOCKED',
    recommendationText: 'Firewall is blocking application connections',
    recommendationActionText: 'Review firewall rules for blocked ports',
    priority: 65,
    cooldownMinutes: 120,
    blocklyWorkspace: {
      blocks: {
        languageVersion: 0,
        blocks: [{
          type: 'logic_if_return',
          inputs: {
            CONDITION: {
              block: {
                type: 'compare_number',
                fields: { OP: 'GT' },
                inputs: {
                  A: { block: { type: 'health_blocked_connections_count' } },
                  B: { block: { type: 'math_number', fields: { NUM: 5 } } }
                }
              }
            }
          }
        }]
      }
    },
    compiledCode: `function evaluate(context) {
  const blockedCount = context.blockedConnectionsCount || 0;
  return blockedCount > 5;
}`
  }
]

export default async function createDefaultAutomations(prisma: Prisma.TransactionClient | PrismaClient) {
  console.log('Seeding default automations...')

  let created = 0
  let updated = 0

  for (const automation of defaultAutomations) {
    try {
      const existing = await prisma.automation.findFirst({
        where: { name: automation.name }
      })

      if (existing) {
        await prisma.automation.update({
          where: { id: existing.id },
          data: {
            description: automation.description,
            recommendationType: automation.recommendationType,
            recommendationText: automation.recommendationText,
            recommendationActionText: automation.recommendationActionText,
            priority: automation.priority,
            cooldownMinutes: automation.cooldownMinutes,
            blocklyWorkspace: automation.blocklyWorkspace,
            generatedCode: automation.compiledCode,
            compiledCode: automation.compiledCode,
            isCompiled: true
          }
        })
        updated++
      } else {
        await prisma.automation.create({
          data: {
            name: automation.name,
            description: automation.description,
            blocklyWorkspace: automation.blocklyWorkspace,
            generatedCode: automation.compiledCode,
            compiledCode: automation.compiledCode,
            isCompiled: true,
            targetScope: AutomationScope.ALL_VMS,
            status: AutomationStatus.APPROVED,
            isEnabled: true,
            priority: automation.priority,
            cooldownMinutes: automation.cooldownMinutes,
            recommendationType: automation.recommendationType,
            recommendationText: automation.recommendationText,
            recommendationActionText: automation.recommendationActionText
          }
        })
        created++
      }
    } catch (error) {
      console.error(`Error seeding automation ${automation.name}:`, error)
    }
  }

  console.log(`Seeded default automations: ${created} created, ${updated} updated`)
}
