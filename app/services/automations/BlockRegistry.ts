import { PrismaClient, CustomBlock, BlockOutputType } from '@prisma/client';

const debug = require('debug')('infinibay:automation:registry');

export interface BlockDefinition {
  type: string;
  message0: string;
  args0?: Array<{
    type: string;
    name: string;
    text?: string;
    check?: string | string[];
    options?: Array<[string, string]>;
    value?: number;
    min?: number;
    max?: number;
  }>;
  output?: string | string[] | null;
  previousStatement?: string | null;
  nextStatement?: string | null;
  colour: number;
  tooltip: string;
  helpUrl?: string;
}

export interface GeneratorFunction {
  (block: BlockProxy): [string, number] | string;
}

export interface BlockProxy {
  getFieldValue: (name: string) => unknown;
  getInputTargetBlock: (name: string) => BlockProxy | null;
  type: string;
  id: string;
}

export interface ToolboxCategory {
  name: string;
  colour: string;
  blocks: BlockDefinition[];
}

export class BlockRegistry {
  private blocks: Map<string, BlockDefinition> = new Map();
  private generators: Map<string, GeneratorFunction> = new Map();
  private customBlockCategories: Map<string, string> = new Map(); // type -> category
  private initialized = false;

  constructor(private prisma: PrismaClient) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;

    debug('Initializing block registry');

    // 1. Register built-in blocks
    this.registerBuiltInBlocks();

    // 2. Load custom blocks from DB
    await this.loadCustomBlocks();

    this.initialized = true;
    debug('Block registry initialized with %d blocks', this.blocks.size);
  }

  // ═══════════════════════════════════════════════════════════════
  // REGISTRATION
  // ═══════════════════════════════════════════════════════════════

  registerBlock(type: string, definition: BlockDefinition, generator: GeneratorFunction): void {
    this.blocks.set(type, definition);
    this.generators.set(type, generator);
    debug('Registered block: %s', type);
  }

  async loadCustomBlocks(): Promise<void> {
    // Clear existing custom blocks first (to handle updates/deletes)
    for (const type of this.customBlockCategories.keys()) {
      this.blocks.delete(type);
      this.generators.delete(type);
    }
    this.customBlockCategories.clear();

    // Load enabled custom blocks from database
    const customBlocks = await this.prisma.customBlock.findMany({
      where: { isEnabled: true },
    });

    for (const block of customBlocks) {
      this.registerCustomBlock(block);
    }

    debug('Loaded %d custom blocks', customBlocks.length);
  }

  private registerCustomBlock(block: CustomBlock): void {
    const definition = block.blockDefinition as unknown as BlockDefinition;
    definition.type = block.name;

    // Create generator function from stored code
    // The code in DB is the body of the function
    try {
      const generatorFn = new Function('block', block.generatorCode) as GeneratorFunction;
      this.registerBlock(block.name, definition, generatorFn);
      // Store category mapping for toolbox
      this.customBlockCategories.set(block.name, block.category);
    } catch (error) {
      debug('Failed to register custom block %s: %s', block.name, error);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // GETTERS
  // ═══════════════════════════════════════════════════════════════

  getBlockDefinition(type: string): BlockDefinition | undefined {
    return this.blocks.get(type);
  }

  getGenerator(type: string): GeneratorFunction | undefined {
    return this.generators.get(type);
  }

  getAllDefinitions(): BlockDefinition[] {
    return Array.from(this.blocks.values());
  }

  // ═══════════════════════════════════════════════════════════════
  // TOOLBOX CONFIGURATION (for frontend)
  // ═══════════════════════════════════════════════════════════════

  getToolboxConfiguration(): ToolboxCategory[] {
    // Category configuration with colors
    const categoryConfig: Array<{ name: string; colour: string; prefix: string }> = [
      { name: 'Health Data', colour: '#10b981', prefix: 'health' },
      { name: 'Logic', colour: '#3b82f6', prefix: 'logic' },
      { name: 'Comparison', colour: '#6366f1', prefix: 'comparison' },
      { name: 'Loops', colour: '#8b5cf6', prefix: 'loops' },
      { name: 'Math', colour: '#06b6d4', prefix: 'math' },
      { name: 'Text', colour: '#ec4899', prefix: 'text' },
      { name: 'Variables', colour: '#f59e0b', prefix: 'variables' },
      { name: 'Actions', colour: '#ef4444', prefix: 'actions' },
    ];

    const categories: ToolboxCategory[] = [];

    for (const config of categoryConfig) {
      // Get built-in blocks by prefix
      const builtInBlocks = this.getBlocksByPrefix(config.prefix);
      // Get custom blocks assigned to this category
      const customBlocks = this.getCustomBlocksByCategory(config.name);

      categories.push({
        name: config.name,
        colour: config.colour,
        blocks: [...builtInBlocks, ...customBlocks],
      });
    }

    // Add "Custom" category for custom blocks not in standard categories
    const customCategoryBlocks = this.getCustomBlocksByCategory('Custom');
    if (customCategoryBlocks.length > 0) {
      categories.push({
        name: 'Custom',
        colour: '#9333ea', // purple
        blocks: customCategoryBlocks,
      });
    }

    return categories;
  }

  private getBlocksByPrefix(prefix: string): BlockDefinition[] {
    return Array.from(this.blocks.entries())
      .filter(([type]) => type.startsWith(`${prefix}_`))
      .map(([, def]) => def);
  }

  private getCustomBlocksByCategory(categoryName: string): BlockDefinition[] {
    const blocks: BlockDefinition[] = [];

    for (const [type, category] of this.customBlockCategories.entries()) {
      if (category === categoryName) {
        const def = this.blocks.get(type);
        if (def) {
          blocks.push(def);
        }
      }
    }

    return blocks;
  }

  // ═══════════════════════════════════════════════════════════════
  // BUILT-IN BLOCKS
  // ═══════════════════════════════════════════════════════════════

  private registerBuiltInBlocks(): void {
    this.registerHealthBlocks();
    this.registerLogicBlocks();
    this.registerComparisonBlocks();
    this.registerLoopBlocks();
    this.registerMathBlocks();
    this.registerTextBlocks();
    this.registerVariableBlocks();
    this.registerActionBlocks();
  }

  private registerHealthBlocks(): void {
    // ═══════════════════════════════════════════════════════════════
    // CPU BLOCKS
    // ═══════════════════════════════════════════════════════════════

    this.registerBlock('health_cpu_usage', {
      type: 'health_cpu_usage',
      message0: '🖥️ CPU Usage %',
      output: 'Number',
      colour: 160,
      tooltip: 'Current CPU usage as a percentage (0-100)',
    }, () => ['context.metrics.cpuUsagePercent', 0]);

    this.registerBlock('health_cpu_core_usage', {
      type: 'health_cpu_core_usage',
      message0: '🖥️ CPU Core %1 Usage %',
      args0: [{
        type: 'field_number',
        name: 'CORE',
        value: 0,
        min: 0,
        max: 64,
      }],
      output: 'Number',
      colour: 160,
      tooltip: 'Usage percentage of a specific CPU core',
    }, (block) => {
      const core = block.getFieldValue('CORE');
      return [`(context.metrics.cpuCoresUsage[${core}] ?? 0)`, 0];
    });

    this.registerBlock('health_cpu_temperature', {
      type: 'health_cpu_temperature',
      message0: '🌡️ CPU Temperature °C',
      output: 'Number',
      colour: 160,
      tooltip: 'Current CPU temperature in Celsius',
    }, () => ['(context.metrics.cpuTemperature ?? 0)', 0]);

    // ═══════════════════════════════════════════════════════════════
    // MEMORY BLOCKS
    // ═══════════════════════════════════════════════════════════════

    this.registerBlock('health_memory_usage', {
      type: 'health_memory_usage',
      message0: '💾 Memory Usage %',
      output: 'Number',
      colour: 160,
      tooltip: 'Current memory usage as a percentage (0-100)',
    }, () => ['((context.metrics.usedMemoryKB / context.metrics.totalMemoryKB) * 100)', 0]);

    this.registerBlock('health_memory_available_gb', {
      type: 'health_memory_available_gb',
      message0: '💾 Available Memory (GB)',
      output: 'Number',
      colour: 160,
      tooltip: 'Available memory in gigabytes',
    }, () => ['(context.metrics.availableMemoryKB / 1024 / 1024)', 0]);

    this.registerBlock('health_swap_usage', {
      type: 'health_swap_usage',
      message0: '💾 Swap Usage %',
      output: 'Number',
      colour: 160,
      tooltip: 'Swap/page file usage percentage',
    }, () => ['((context.metrics.swapUsedKB / context.metrics.swapTotalKB) * 100)', 0]);

    // ═══════════════════════════════════════════════════════════════
    // DISK BLOCKS
    // ═══════════════════════════════════════════════════════════════

    this.registerBlock('health_disk_usage', {
      type: 'health_disk_usage',
      message0: '💿 Disk %1 Usage %',
      args0: [{
        type: 'field_input',
        name: 'DRIVE',
        text: 'C:',
      }],
      output: 'Number',
      colour: 160,
      tooltip: 'Disk usage percentage for the specified drive',
    }, (block) => {
      const drive = block.getFieldValue('DRIVE');
      return [`context.getDiskUsagePercent('${drive}')`, 0];
    });

    this.registerBlock('health_disk_free_gb', {
      type: 'health_disk_free_gb',
      message0: '💿 Free space on %1 (GB)',
      args0: [{
        type: 'field_input',
        name: 'DRIVE',
        text: 'C:',
      }],
      output: 'Number',
      colour: 160,
      tooltip: 'Free disk space in gigabytes',
    }, (block) => {
      const drive = block.getFieldValue('DRIVE');
      return [`context.getDiskFreeGB('${drive}')`, 0];
    });

    this.registerBlock('health_disk_total_gb', {
      type: 'health_disk_total_gb',
      message0: '💿 Total size of %1 (GB)',
      args0: [{
        type: 'field_input',
        name: 'DRIVE',
        text: 'C:',
      }],
      output: 'Number',
      colour: 160,
      tooltip: 'Total disk size in gigabytes',
    }, (block) => {
      const drive = block.getFieldValue('DRIVE');
      return [`context.getDiskTotalGB('${drive}')`, 0];
    });

    this.registerBlock('health_all_disks', {
      type: 'health_all_disks',
      message0: '💿 All disks',
      output: 'Array',
      colour: 260,
      tooltip: 'List of all disk drives with their info',
    }, () => ['context.disks', 0]);

    // ═══════════════════════════════════════════════════════════════
    // PROCESS BLOCKS
    // ═══════════════════════════════════════════════════════════════

    this.registerBlock('health_process_running', {
      type: 'health_process_running',
      message0: '⚙️ Process %1 is running',
      args0: [{
        type: 'field_input',
        name: 'PROCESS',
        text: 'notepad',
      }],
      output: 'Boolean',
      colour: 160,
      tooltip: 'Check if a process is currently running',
    }, (block) => {
      const process = block.getFieldValue('PROCESS');
      return [`context.isProcessRunning('${process}')`, 0];
    });

    this.registerBlock('health_process_cpu', {
      type: 'health_process_cpu',
      message0: '⚙️ CPU % of process %1',
      args0: [{
        type: 'field_input',
        name: 'PROCESS',
        text: 'chrome',
      }],
      output: 'Number',
      colour: 160,
      tooltip: 'CPU usage percentage of a specific process',
    }, (block) => {
      const process = block.getFieldValue('PROCESS');
      return [`context.getProcessCPU('${process}')`, 0];
    });

    this.registerBlock('health_process_memory', {
      type: 'health_process_memory',
      message0: '⚙️ Memory (MB) of process %1',
      args0: [{
        type: 'field_input',
        name: 'PROCESS',
        text: 'chrome',
      }],
      output: 'Number',
      colour: 160,
      tooltip: 'Memory usage in MB of a specific process',
    }, (block) => {
      const process = block.getFieldValue('PROCESS');
      return [`(context.getProcessMemoryKB('${process}') / 1024)`, 0];
    });

    this.registerBlock('health_high_cpu_processes', {
      type: 'health_high_cpu_processes',
      message0: '⚙️ Processes with CPU > %1 %',
      args0: [{
        type: 'field_number',
        name: 'THRESHOLD',
        value: 50,
        min: 0,
        max: 100,
      }],
      output: 'Array',
      colour: 260,
      tooltip: 'List of processes exceeding the CPU threshold',
    }, (block) => {
      const threshold = block.getFieldValue('THRESHOLD');
      return [`context.getHighCPUProcesses(${threshold})`, 0];
    });

    this.registerBlock('health_high_memory_processes', {
      type: 'health_high_memory_processes',
      message0: '⚙️ Processes using > %1 MB memory',
      args0: [{
        type: 'field_number',
        name: 'THRESHOLD',
        value: 500,
        min: 0,
        max: 32000,
      }],
      output: 'Array',
      colour: 260,
      tooltip: 'List of processes exceeding the memory threshold',
    }, (block) => {
      const threshold = block.getFieldValue('THRESHOLD');
      return [`context.getHighMemoryProcesses(${threshold} * 1024)`, 0];
    });

    this.registerBlock('health_process_count', {
      type: 'health_process_count',
      message0: '⚙️ Total running processes',
      output: 'Number',
      colour: 160,
      tooltip: 'Number of running processes',
    }, () => ['context.processes.length', 0]);

    // ═══════════════════════════════════════════════════════════════
    // WINDOWS DEFENDER BLOCKS
    // ═══════════════════════════════════════════════════════════════

    this.registerBlock('health_defender_enabled', {
      type: 'health_defender_enabled',
      message0: '🛡️ Windows Defender enabled',
      output: 'Boolean',
      colour: 0,
      tooltip: 'Check if Windows Defender is enabled',
    }, () => ['context.defender.isEnabled', 0]);

    this.registerBlock('health_defender_realtime', {
      type: 'health_defender_realtime',
      message0: '🛡️ Real-time protection enabled',
      output: 'Boolean',
      colour: 0,
      tooltip: 'Check if real-time protection is enabled',
    }, () => ['context.defender.realTimeProtection', 0]);

    this.registerBlock('health_defender_threats', {
      type: 'health_defender_threats',
      message0: '🛡️ Detected threat count',
      output: 'Number',
      colour: 0,
      tooltip: 'Number of threats detected by Windows Defender',
    }, () => ['context.defender.threatCount', 0]);

    this.registerBlock('health_defender_last_scan_days', {
      type: 'health_defender_last_scan_days',
      message0: '🛡️ Days since last scan',
      output: 'Number',
      colour: 0,
      tooltip: 'Number of days since the last Defender scan',
    }, () => ['context.defender.daysSinceLastScan', 0]);

    // ═══════════════════════════════════════════════════════════════
    // WINDOWS UPDATE BLOCKS
    // ═══════════════════════════════════════════════════════════════

    this.registerBlock('health_pending_updates', {
      type: 'health_pending_updates',
      message0: '🔄 Pending updates',
      output: 'Number',
      colour: 45,
      tooltip: 'Number of pending Windows updates',
    }, () => ['context.updates.pendingCount', 0]);

    this.registerBlock('health_updates_critical', {
      type: 'health_updates_critical',
      message0: '🔄 Critical updates pending',
      output: 'Number',
      colour: 45,
      tooltip: 'Number of critical/security updates pending',
    }, () => ['context.updates.criticalCount', 0]);

    this.registerBlock('health_days_since_update', {
      type: 'health_days_since_update',
      message0: '🔄 Days since last update',
      output: 'Number',
      colour: 45,
      tooltip: 'Number of days since Windows was last updated',
    }, () => ['context.updates.daysSinceLastUpdate', 0]);

    // ═══════════════════════════════════════════════════════════════
    // SYSTEM BLOCKS
    // ═══════════════════════════════════════════════════════════════

    this.registerBlock('health_uptime_hours', {
      type: 'health_uptime_hours',
      message0: '⏱️ System uptime (hours)',
      output: 'Number',
      colour: 180,
      tooltip: 'How long the system has been running in hours',
    }, () => ['(context.metrics.uptime / 3600)', 0]);

    this.registerBlock('health_vm_name', {
      type: 'health_vm_name',
      message0: '📛 VM Name',
      output: 'String',
      colour: 180,
      tooltip: 'Name of the virtual machine',
    }, () => ['context.vmName', 0]);

    // ═══════════════════════════════════════════════════════════════
    // NETWORK BLOCKS
    // ═══════════════════════════════════════════════════════════════

    this.registerBlock('health_blocked_connections', {
      type: 'health_blocked_connections',
      message0: '🔒 Blocked connection attempts',
      output: 'Array',
      colour: 260,
      tooltip: 'List of blocked port connection attempts',
    }, () => ['context.blockedConnections', 0]);

    this.registerBlock('health_blocked_connections_count', {
      type: 'health_blocked_connections_count',
      message0: '🔒 Blocked connection count',
      output: 'Number',
      colour: 0,
      tooltip: 'Number of blocked connection attempts',
    }, () => ['context.blockedConnections.length', 0]);
  }

  private registerLogicBlocks(): void {
    // And
    this.registerBlock('logic_and', {
      type: 'logic_and',
      message0: '%1 and %2',
      args0: [
        { type: 'input_value', name: 'A', check: 'Boolean' },
        { type: 'input_value', name: 'B', check: 'Boolean' },
      ],
      output: 'Boolean',
      colour: 210,
      tooltip: 'Both conditions must be true',
    }, () => ['(A && B)', 0]);

    // Or
    this.registerBlock('logic_or', {
      type: 'logic_or',
      message0: '%1 or %2',
      args0: [
        { type: 'input_value', name: 'A', check: 'Boolean' },
        { type: 'input_value', name: 'B', check: 'Boolean' },
      ],
      output: 'Boolean',
      colour: 210,
      tooltip: 'Either condition can be true',
    }, () => ['(A || B)', 0]);

    // Not
    this.registerBlock('logic_not', {
      type: 'logic_not',
      message0: 'not %1',
      args0: [
        { type: 'input_value', name: 'VALUE', check: 'Boolean' },
      ],
      output: 'Boolean',
      colour: 210,
      tooltip: 'Negate a boolean value',
    }, () => ['(!VALUE)', 0]);

    // Boolean true
    this.registerBlock('logic_true', {
      type: 'logic_true',
      message0: 'true',
      output: 'Boolean',
      colour: 210,
      tooltip: 'Boolean true value',
    }, () => ['true', 0]);

    // Boolean false
    this.registerBlock('logic_false', {
      type: 'logic_false',
      message0: 'false',
      output: 'Boolean',
      colour: 210,
      tooltip: 'Boolean false value',
    }, () => ['false', 0]);
  }

  private registerComparisonBlocks(): void {
    // ═══════════════════════════════════════════════════════════════
    // NUMERIC COMPARISON
    // ═══════════════════════════════════════════════════════════════

    this.registerBlock('comparison_number', {
      type: 'comparison_number',
      message0: '%1 %2 %3',
      args0: [
        { type: 'input_value', name: 'A', check: 'Number' },
        {
          type: 'field_dropdown',
          name: 'OP',
          options: [
            ['=', 'EQ'],
            ['≠', 'NEQ'],
            ['<', 'LT'],
            ['≤', 'LTE'],
            ['>', 'GT'],
            ['≥', 'GTE'],
          ],
        },
        { type: 'input_value', name: 'B', check: 'Number' },
      ],
      output: 'Boolean',
      colour: 230,
      tooltip: 'Compare two numbers',
    }, (block) => {
      const op = block.getFieldValue('OP') as string;
      const operators: Record<string, string> = {
        EQ: '===', NEQ: '!==', LT: '<', LTE: '<=', GT: '>', GTE: '>=',
      };
      return [`(A ${operators[op]} B)`, 0];
    });

    // Between
    this.registerBlock('comparison_between', {
      type: 'comparison_between',
      message0: '%1 is between %2 and %3',
      args0: [
        { type: 'input_value', name: 'VALUE', check: 'Number' },
        { type: 'input_value', name: 'MIN', check: 'Number' },
        { type: 'input_value', name: 'MAX', check: 'Number' },
      ],
      output: 'Boolean',
      colour: 230,
      tooltip: 'Check if a value is within a range (inclusive)',
    }, () => ['(VALUE >= MIN && VALUE <= MAX)', 0]);

    // ═══════════════════════════════════════════════════════════════
    // TEXT COMPARISON
    // ═══════════════════════════════════════════════════════════════

    this.registerBlock('comparison_text', {
      type: 'comparison_text',
      message0: '%1 %2 %3',
      args0: [
        { type: 'input_value', name: 'A', check: 'String' },
        {
          type: 'field_dropdown',
          name: 'OP',
          options: [
            ['equals', 'EQ'],
            ['not equals', 'NEQ'],
            ['contains', 'CONTAINS'],
            ['starts with', 'STARTS'],
            ['ends with', 'ENDS'],
          ],
        },
        { type: 'input_value', name: 'B', check: 'String' },
      ],
      output: 'Boolean',
      colour: 230,
      tooltip: 'Compare two text values',
    }, (block) => {
      const op = block.getFieldValue('OP') as string;
      switch (op) {
        case 'EQ': return ['(A === B)', 0];
        case 'NEQ': return ['(A !== B)', 0];
        case 'CONTAINS': return ['A.includes(B)', 0];
        case 'STARTS': return ['A.startsWith(B)', 0];
        case 'ENDS': return ['A.endsWith(B)', 0];
        default: return ['false', 0];
      }
    });

    // ═══════════════════════════════════════════════════════════════
    // ARRAY OPERATIONS
    // ═══════════════════════════════════════════════════════════════

    this.registerBlock('array_is_empty', {
      type: 'array_is_empty',
      message0: '%1 is empty',
      args0: [
        { type: 'input_value', name: 'LIST', check: 'Array' },
      ],
      output: 'Boolean',
      colour: 260,
      tooltip: 'Check if a list has no items',
    }, () => ['(LIST.length === 0)', 0]);

    this.registerBlock('array_length', {
      type: 'array_length',
      message0: 'length of %1',
      args0: [
        { type: 'input_value', name: 'LIST', check: 'Array' },
      ],
      output: 'Number',
      colour: 260,
      tooltip: 'Get the number of items in a list',
    }, () => ['LIST.length', 0]);

    this.registerBlock('array_contains', {
      type: 'array_contains',
      message0: '%1 contains %2',
      args0: [
        { type: 'input_value', name: 'LIST', check: 'Array' },
        { type: 'input_value', name: 'ITEM' },
      ],
      output: 'Boolean',
      colour: 260,
      tooltip: 'Check if a list contains a specific item',
    }, () => ['LIST.includes(ITEM)', 0]);
  }

  private registerLoopBlocks(): void {
    // For Each
    this.registerBlock('loops_foreach', {
      type: 'loops_foreach',
      message0: 'for each %1 in %2 do %3',
      args0: [
        { type: 'field_input', name: 'VAR', text: 'item' },
        { type: 'input_value', name: 'LIST', check: 'Array' },
        { type: 'input_statement', name: 'DO' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 120,
      tooltip: 'Loop through each item in a list',
    }, (block) => {
      const variable = block.getFieldValue('VAR');
      return `for (const ${variable} of LIST) {\n  DO\n}`;
    });

    // Repeat N times
    this.registerBlock('loops_repeat', {
      type: 'loops_repeat',
      message0: 'repeat %1 times %2',
      args0: [
        { type: 'input_value', name: 'TIMES', check: 'Number' },
        { type: 'input_statement', name: 'DO' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 120,
      tooltip: 'Repeat actions a specific number of times',
    }, () => 'for (let i = 0; i < TIMES; i++) {\n  DO\n}');
  }

  private registerMathBlocks(): void {
    // Number literal
    this.registerBlock('math_number', {
      type: 'math_number',
      message0: '%1',
      args0: [{
        type: 'field_number',
        name: 'NUM',
        value: 0,
      }],
      output: 'Number',
      colour: 180,
      tooltip: 'A number value',
    }, (block) => [String(block.getFieldValue('NUM')), 0]);

    // Arithmetic
    this.registerBlock('math_arithmetic', {
      type: 'math_arithmetic',
      message0: '%1 %2 %3',
      args0: [
        { type: 'input_value', name: 'A', check: 'Number' },
        {
          type: 'field_dropdown',
          name: 'OP',
          options: [['+', 'ADD'], ['-', 'SUB'], ['×', 'MUL'], ['÷', 'DIV'], ['^', 'POW']],
        },
        { type: 'input_value', name: 'B', check: 'Number' },
      ],
      output: 'Number',
      colour: 180,
      tooltip: 'Arithmetic operation',
    }, (block) => {
      const op = block.getFieldValue('OP') as string;
      const operators: Record<string, string> = {
        ADD: '+', SUB: '-', MUL: '*', DIV: '/', POW: '**',
      };
      return [`(A ${operators[op]} B)`, 0];
    });

    // Sum of array
    this.registerBlock('math_sum', {
      type: 'math_sum',
      message0: 'sum of %1',
      args0: [{ type: 'input_value', name: 'LIST', check: 'Array' }],
      output: 'Number',
      colour: 180,
      tooltip: 'Sum all numbers in a list',
    }, () => ['LIST.reduce((a, b) => a + b, 0)', 0]);

    // Average of array
    this.registerBlock('math_average', {
      type: 'math_average',
      message0: 'average of %1',
      args0: [{ type: 'input_value', name: 'LIST', check: 'Array' }],
      output: 'Number',
      colour: 180,
      tooltip: 'Average of all numbers in a list',
    }, () => ['(LIST.reduce((a, b) => a + b, 0) / LIST.length)', 0]);

    // Min/Max
    this.registerBlock('math_minmax', {
      type: 'math_minmax',
      message0: '%1 of %2',
      args0: [
        {
          type: 'field_dropdown',
          name: 'OP',
          options: [['minimum', 'MIN'], ['maximum', 'MAX']],
        },
        { type: 'input_value', name: 'LIST', check: 'Array' },
      ],
      output: 'Number',
      colour: 180,
      tooltip: 'Find minimum or maximum value',
    }, (block) => {
      const op = block.getFieldValue('OP');
      return [op === 'MIN' ? 'Math.min(...LIST)' : 'Math.max(...LIST)', 0];
    });

    // Round
    this.registerBlock('math_round', {
      type: 'math_round',
      message0: '%1 %2',
      args0: [
        {
          type: 'field_dropdown',
          name: 'OP',
          options: [['round', 'ROUND'], ['floor', 'FLOOR'], ['ceiling', 'CEIL']],
        },
        { type: 'input_value', name: 'NUM', check: 'Number' },
      ],
      output: 'Number',
      colour: 180,
      tooltip: 'Round a number',
    }, (block) => {
      const op = block.getFieldValue('OP') as string;
      const fns: Record<string, string> = { ROUND: 'round', FLOOR: 'floor', CEIL: 'ceil' };
      return [`Math.${fns[op]}(NUM)`, 0];
    });
  }

  private registerTextBlocks(): void {
    // Text literal
    this.registerBlock('text', {
      type: 'text',
      message0: '" %1 "',
      args0: [{
        type: 'field_input',
        name: 'TEXT',
        text: '',
      }],
      output: 'String',
      colour: 160,
      tooltip: 'A text value',
    }, (block) => {
      const text = String(block.getFieldValue('TEXT') || '');
      return [`'${text.replace(/'/g, "\\'")}'`, 0];
    });

    // Text join
    this.registerBlock('text_join', {
      type: 'text_join',
      message0: 'join %1 and %2',
      args0: [
        { type: 'input_value', name: 'A', check: 'String' },
        { type: 'input_value', name: 'B', check: 'String' },
      ],
      output: 'String',
      colour: 160,
      tooltip: 'Combine two texts',
    }, () => ['(A + B)', 0]);

    // Text length
    this.registerBlock('text_length', {
      type: 'text_length',
      message0: 'length of %1',
      args0: [{ type: 'input_value', name: 'TEXT', check: 'String' }],
      output: 'Number',
      colour: 160,
      tooltip: 'Number of characters in text',
    }, () => ['TEXT.length', 0]);

    // Text contains
    this.registerBlock('text_contains', {
      type: 'text_contains',
      message0: '%1 contains %2',
      args0: [
        { type: 'input_value', name: 'TEXT', check: 'String' },
        { type: 'input_value', name: 'SEARCH', check: 'String' },
      ],
      output: 'Boolean',
      colour: 160,
      tooltip: 'Check if text contains a substring',
    }, () => ['TEXT.includes(SEARCH)', 0]);
  }

  private registerVariableBlocks(): void {
    // Set variable
    this.registerBlock('variables_set', {
      type: 'variables_set',
      message0: 'set %1 to %2',
      args0: [
        { type: 'field_input', name: 'VAR', text: 'x' },
        { type: 'input_value', name: 'VALUE' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 330,
      tooltip: 'Set a variable to a value',
    }, (block) => {
      const variable = block.getFieldValue('VAR');
      return `let ${variable} = VALUE;`;
    });

    // Get variable
    this.registerBlock('variables_get', {
      type: 'variables_get',
      message0: '%1',
      args0: [{ type: 'field_input', name: 'VAR', text: 'x' }],
      output: null,
      colour: 330,
      tooltip: 'Get a variable value',
    }, (block) => [String(block.getFieldValue('VAR')), 0]);

    // Change variable by
    this.registerBlock('variables_change', {
      type: 'variables_change',
      message0: 'change %1 by %2',
      args0: [
        { type: 'field_input', name: 'VAR', text: 'x' },
        { type: 'input_value', name: 'DELTA', check: 'Number' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 330,
      tooltip: 'Add a value to a variable',
    }, (block) => {
      const variable = block.getFieldValue('VAR');
      return `${variable} += DELTA;`;
    });
  }

  private registerActionBlocks(): void {
    // Return true (trigger automation)
    this.registerBlock('actions_trigger', {
      type: 'actions_trigger',
      message0: '⚡ Trigger automation',
      previousStatement: null,
      colour: 0,
      tooltip: 'Mark this automation as triggered (returns true)',
    }, () => 'return true;');

    // Return false (don't trigger)
    this.registerBlock('actions_skip', {
      type: 'actions_skip',
      message0: '⏭ Skip (don\'t trigger)',
      previousStatement: null,
      colour: 0,
      tooltip: 'Skip this automation (returns false)',
    }, () => 'return false;');
  }
}

// Singleton instance
let blockRegistryInstance: BlockRegistry | null = null;

export const getBlockRegistry = async (prisma: PrismaClient): Promise<BlockRegistry> => {
  if (!blockRegistryInstance) {
    blockRegistryInstance = new BlockRegistry(prisma);
    await blockRegistryInstance.initialize();
  }
  return blockRegistryInstance;
};
