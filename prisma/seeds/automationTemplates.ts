/**
 * Automation Templates Seed
 *
 * Pre-built automation templates for common monitoring scenarios.
 * Templates are organized by category: Performance, Storage, Security, Updates, Applications.
 */

import { PrismaClient, Prisma, RecommendationType } from '@prisma/client'

interface AutomationTemplateData {
  name: string
  description: string
  category: string
  recommendationType: RecommendationType | null
  blocklyWorkspace: object
}

const templates: AutomationTemplateData[] = [
  // ═══════════════════════════════════════════════════════════════
  // PERFORMANCE TEMPLATES
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'High CPU Alert',
    description: 'Triggers when CPU usage exceeds 90% - helps identify VMs that need more resources',
    category: 'Performance',
    recommendationType: 'UNDER_PROVISIONED',
    blocklyWorkspace: {
      blocks: {
        blocks: [
          {
            type: 'logic_if_return',
            id: 'if1',
            inputs: {
              CONDITION: {
                block: {
                  type: 'compare_number',
                  id: 'cmp1',
                  fields: { OP: 'GT' },
                  inputs: {
                    A: { block: { type: 'health_cpu_usage', id: 'cpu1' } },
                    B: { block: { type: 'math_number', id: 'num1', fields: { NUM: 90 } } }
                  }
                }
              },
              DO: {
                block: { type: 'action_trigger', id: 'trigger1' }
              }
            }
          }
        ]
      }
    }
  },
  {
    name: 'High Memory Usage',
    description: 'Triggers when memory usage exceeds 85% - prevents out-of-memory issues',
    category: 'Performance',
    recommendationType: 'UNDER_PROVISIONED',
    blocklyWorkspace: {
      blocks: {
        blocks: [
          {
            type: 'logic_if_return',
            id: 'if1',
            inputs: {
              CONDITION: {
                block: {
                  type: 'compare_number',
                  id: 'cmp1',
                  fields: { OP: 'GT' },
                  inputs: {
                    A: { block: { type: 'health_memory_usage', id: 'mem1' } },
                    B: { block: { type: 'math_number', id: 'num1', fields: { NUM: 85 } } }
                  }
                }
              },
              DO: {
                block: { type: 'action_trigger', id: 'trigger1' }
              }
            }
          }
        ]
      }
    }
  },
  {
    name: 'Under-utilized VM',
    description: 'Identifies VMs with consistently low resource usage - save resources by downsizing',
    category: 'Performance',
    recommendationType: 'OVER_PROVISIONED',
    blocklyWorkspace: {
      blocks: {
        blocks: [
          {
            type: 'logic_if_return',
            id: 'if1',
            inputs: {
              CONDITION: {
                block: {
                  type: 'logic_and',
                  id: 'and1',
                  inputs: {
                    A: {
                      block: {
                        type: 'compare_number',
                        id: 'cmp1',
                        fields: { OP: 'LT' },
                        inputs: {
                          A: { block: { type: 'health_cpu_usage', id: 'cpu1' } },
                          B: { block: { type: 'math_number', id: 'num1', fields: { NUM: 10 } } }
                        }
                      }
                    },
                    B: {
                      block: {
                        type: 'compare_number',
                        id: 'cmp2',
                        fields: { OP: 'LT' },
                        inputs: {
                          A: { block: { type: 'health_memory_usage', id: 'mem1' } },
                          B: { block: { type: 'math_number', id: 'num2', fields: { NUM: 20 } } }
                        }
                      }
                    }
                  }
                }
              },
              DO: {
                block: { type: 'action_trigger', id: 'trigger1' }
              }
            }
          }
        ]
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // STORAGE TEMPLATES
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Low Disk Space',
    description: 'Triggers when disk C: has less than 10GB free - prevents storage issues',
    category: 'Storage',
    recommendationType: 'DISK_SPACE_LOW',
    blocklyWorkspace: {
      blocks: {
        blocks: [
          {
            type: 'logic_if_return',
            id: 'if1',
            inputs: {
              CONDITION: {
                block: {
                  type: 'compare_number',
                  id: 'cmp1',
                  fields: { OP: 'LT' },
                  inputs: {
                    A: { block: { type: 'health_disk_free_gb', id: 'disk1', fields: { DRIVE: 'C:' } } },
                    B: { block: { type: 'math_number', id: 'num1', fields: { NUM: 10 } } }
                  }
                }
              },
              DO: {
                block: { type: 'action_trigger', id: 'trigger1' }
              }
            }
          }
        ]
      }
    }
  },
  {
    name: 'Disk Usage Warning',
    description: 'Triggers when any disk exceeds 85% usage',
    category: 'Storage',
    recommendationType: 'DISK_SPACE_LOW',
    blocklyWorkspace: {
      blocks: {
        blocks: [
          {
            type: 'logic_if_return',
            id: 'if1',
            inputs: {
              CONDITION: {
                block: {
                  type: 'compare_number',
                  id: 'cmp1',
                  fields: { OP: 'GT' },
                  inputs: {
                    A: { block: { type: 'health_disk_usage', id: 'disk1', fields: { DRIVE: 'C:' } } },
                    B: { block: { type: 'math_number', id: 'num1', fields: { NUM: 85 } } }
                  }
                }
              },
              DO: {
                block: { type: 'action_trigger', id: 'trigger1' }
              }
            }
          }
        ]
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // SECURITY TEMPLATES
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Windows Defender Disabled',
    description: 'Alerts when Windows Defender protection is turned off',
    category: 'Security',
    recommendationType: 'DEFENDER_DISABLED',
    blocklyWorkspace: {
      blocks: {
        blocks: [
          {
            type: 'logic_if_return',
            id: 'if1',
            inputs: {
              CONDITION: {
                block: {
                  type: 'logic_not',
                  id: 'not1',
                  inputs: {
                    VALUE: { block: { type: 'health_defender_enabled', id: 'def1' } }
                  }
                }
              },
              DO: {
                block: { type: 'action_trigger', id: 'trigger1' }
              }
            }
          }
        ]
      }
    }
  },
  {
    name: 'Threat Detected',
    description: 'Alerts when Windows Defender has detected threats',
    category: 'Security',
    recommendationType: 'DEFENDER_THREAT',
    blocklyWorkspace: {
      blocks: {
        blocks: [
          {
            type: 'logic_if_return',
            id: 'if1',
            inputs: {
              CONDITION: {
                block: {
                  type: 'compare_number',
                  id: 'cmp1',
                  fields: { OP: 'GT' },
                  inputs: {
                    A: { block: { type: 'health_defender_threats', id: 'thr1' } },
                    B: { block: { type: 'math_number', id: 'num1', fields: { NUM: 0 } } }
                  }
                }
              },
              DO: {
                block: { type: 'action_trigger', id: 'trigger1' }
              }
            }
          }
        ]
      }
    }
  },
  {
    name: 'Blocked Network Connections',
    description: 'Alerts when firewall is blocking application connections',
    category: 'Security',
    recommendationType: 'PORT_BLOCKED',
    blocklyWorkspace: {
      blocks: {
        blocks: [
          {
            type: 'logic_if_return',
            id: 'if1',
            inputs: {
              CONDITION: {
                block: {
                  type: 'compare_number',
                  id: 'cmp1',
                  fields: { OP: 'GT' },
                  inputs: {
                    A: { block: { type: 'health_blocked_connections_count', id: 'blk1' } },
                    B: { block: { type: 'math_number', id: 'num1', fields: { NUM: 5 } } }
                  }
                }
              },
              DO: {
                block: { type: 'action_trigger', id: 'trigger1' }
              }
            }
          }
        ]
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // UPDATE TEMPLATES
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Pending Windows Updates',
    description: 'Alerts when there are pending Windows updates',
    category: 'Updates',
    recommendationType: 'OS_UPDATE_AVAILABLE',
    blocklyWorkspace: {
      blocks: {
        blocks: [
          {
            type: 'logic_if_return',
            id: 'if1',
            inputs: {
              CONDITION: {
                block: {
                  type: 'compare_number',
                  id: 'cmp1',
                  fields: { OP: 'GT' },
                  inputs: {
                    A: { block: { type: 'health_pending_updates', id: 'upd1' } },
                    B: { block: { type: 'math_number', id: 'num1', fields: { NUM: 0 } } }
                  }
                }
              },
              DO: {
                block: { type: 'action_trigger', id: 'trigger1' }
              }
            }
          }
        ]
      }
    }
  },
  {
    name: 'Critical Updates Pending',
    description: 'Alerts when there are critical/security updates waiting',
    category: 'Updates',
    recommendationType: 'OS_UPDATE_AVAILABLE',
    blocklyWorkspace: {
      blocks: {
        blocks: [
          {
            type: 'logic_if_return',
            id: 'if1',
            inputs: {
              CONDITION: {
                block: {
                  type: 'compare_number',
                  id: 'cmp1',
                  fields: { OP: 'GT' },
                  inputs: {
                    A: { block: { type: 'health_updates_critical', id: 'crit1' } },
                    B: { block: { type: 'math_number', id: 'num1', fields: { NUM: 0 } } }
                  }
                }
              },
              DO: {
                block: { type: 'action_trigger', id: 'trigger1' }
              }
            }
          }
        ]
      }
    }
  },
  {
    name: 'Outdated System',
    description: "Alerts when Windows hasn't been updated in over 30 days",
    category: 'Updates',
    recommendationType: 'OS_UPDATE_AVAILABLE',
    blocklyWorkspace: {
      blocks: {
        blocks: [
          {
            type: 'logic_if_return',
            id: 'if1',
            inputs: {
              CONDITION: {
                block: {
                  type: 'compare_number',
                  id: 'cmp1',
                  fields: { OP: 'GT' },
                  inputs: {
                    A: { block: { type: 'health_days_since_update', id: 'days1' } },
                    B: { block: { type: 'math_number', id: 'num1', fields: { NUM: 30 } } }
                  }
                }
              },
              DO: {
                block: { type: 'action_trigger', id: 'trigger1' }
              }
            }
          }
        ]
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // APPLICATION TEMPLATES
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'High CPU Application',
    description: 'Identifies applications consuming more than 80% CPU',
    category: 'Applications',
    recommendationType: 'HIGH_CPU_APP',
    blocklyWorkspace: {
      blocks: {
        blocks: [
          {
            type: 'logic_if_return',
            id: 'if1',
            inputs: {
              CONDITION: {
                block: {
                  type: 'logic_not',
                  id: 'not1',
                  inputs: {
                    VALUE: {
                      block: {
                        type: 'array_is_empty',
                        id: 'emp1',
                        inputs: {
                          LIST: {
                            block: {
                              type: 'health_high_cpu_processes',
                              id: 'proc1',
                              fields: { THRESHOLD: 80 }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              },
              DO: {
                block: { type: 'action_trigger', id: 'trigger1' }
              }
            }
          }
        ]
      }
    }
  },
  {
    name: 'High Memory Application',
    description: 'Identifies applications using more than 1GB of memory',
    category: 'Applications',
    recommendationType: 'HIGH_RAM_APP',
    blocklyWorkspace: {
      blocks: {
        blocks: [
          {
            type: 'logic_if_return',
            id: 'if1',
            inputs: {
              CONDITION: {
                block: {
                  type: 'logic_not',
                  id: 'not1',
                  inputs: {
                    VALUE: {
                      block: {
                        type: 'array_is_empty',
                        id: 'emp1',
                        inputs: {
                          LIST: {
                            block: {
                              type: 'health_high_memory_processes',
                              id: 'proc1',
                              fields: { THRESHOLD: 1024 }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              },
              DO: {
                block: { type: 'action_trigger', id: 'trigger1' }
              }
            }
          }
        ]
      }
    }
  }
]

export default async function createAutomationTemplates (prisma: Prisma.TransactionClient | PrismaClient) {
  console.log('Seeding automation templates...')

  for (const template of templates) {
    try {
      await prisma.automationTemplate.upsert({
        where: { name: template.name },
        update: {
          description: template.description,
          category: template.category,
          recommendationType: template.recommendationType,
          blocklyWorkspace: template.blocklyWorkspace,
          isEnabled: true
        },
        create: {
          name: template.name,
          description: template.description,
          category: template.category,
          recommendationType: template.recommendationType,
          blocklyWorkspace: template.blocklyWorkspace,
          isEnabled: true,
          usageCount: 0
        }
      })
    } catch (error) {
      console.error(`Error creating template ${template.name}:`, error)
    }
  }

  console.log(`Seeded ${templates.length} automation templates`)
}
