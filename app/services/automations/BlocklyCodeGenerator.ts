import { BlockRegistry, BlockProxy, GeneratorFunction } from './BlockRegistry';

const debug = require('debug')('infinibay:automation:generator');

interface BlocklyWorkspace {
  blocks?: {
    blocks: BlocklyBlock[];
  };
}

interface BlocklyBlock {
  type: string;
  id: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: BlocklyBlock; shadow?: BlocklyBlock }>;
  next?: { block?: BlocklyBlock };
}

export class BlocklyCodeGenerator {
  constructor(private registry: BlockRegistry) {}

  /**
   * Generate TypeScript code from a Blockly workspace JSON
   */
  generate(workspace: Record<string, unknown>): string {
    debug('Generating code from workspace');

    const ws = workspace as BlocklyWorkspace;
    if (!ws.blocks?.blocks?.length) {
      return 'return false; // Empty workspace';
    }

    const codeLines: string[] = [];

    // Process each top-level block
    for (const block of ws.blocks.blocks) {
      const code = this.generateBlock(block);
      if (code) {
        codeLines.push(code);
      }
    }

    const generatedCode = codeLines.join('\n');
    debug('Generated code:\n%s', generatedCode);

    // Ensure we always return a boolean
    if (!generatedCode.includes('return')) {
      return generatedCode + '\nreturn false;';
    }

    return generatedCode;
  }

  /**
   * Generate code for a single block and its chain
   */
  private generateBlock(block: BlocklyBlock): string {
    const generator = this.registry.getGenerator(block.type);
    if (!generator) {
      debug('No generator for block type: %s', block.type);
      return `// Unknown block: ${block.type}`;
    }

    // Create block proxy for the generator
    const blockProxy = this.createBlockProxy(block);
    let result = generator(blockProxy);

    let code: string;
    if (Array.isArray(result)) {
      code = result[0];
    } else {
      code = result;
    }

    // Resolve input placeholders
    code = this.resolveInputs(code, block);

    // Process next block in chain (if exists)
    if (block.next?.block) {
      code += '\n' + this.generateBlock(block.next.block);
    }

    return code;
  }

  /**
   * Generate code for a value block (returns a value, not a statement)
   */
  private generateValue(block: BlocklyBlock | null | undefined): string {
    if (!block) {
      return 'null';
    }

    const generator = this.registry.getGenerator(block.type);
    if (!generator) {
      debug('No generator for value block type: %s', block.type);
      return 'null';
    }

    const blockProxy = this.createBlockProxy(block);
    const result = generator(blockProxy);

    let code: string;
    if (Array.isArray(result)) {
      code = result[0];
    } else {
      // For statement blocks used as values, extract the expression
      code = result.replace(/;$/, '').replace(/^return\s+/, '');
    }

    // Resolve nested inputs
    code = this.resolveInputs(code, block);

    return code;
  }

  /**
   * Resolve placeholder inputs in generated code
   */
  private resolveInputs(code: string, block: BlocklyBlock): string {
    if (!block.inputs) {
      return code;
    }

    // Find all input placeholders (single word uppercase names)
    const inputPattern = /\b([A-Z][A-Z0-9_]*)\b/g;
    let resolvedCode = code;

    const matches = code.matchAll(inputPattern);
    for (const match of matches) {
      const inputName = match[1];

      // Skip common JavaScript keywords and operators
      if (['Math', 'MIN', 'MAX', 'ROUND', 'FLOOR', 'CEIL', 'ADD', 'SUB', 'MUL', 'DIV', 'POW', 'EQ', 'NEQ', 'LT', 'LTE', 'GT', 'GTE'].includes(inputName)) {
        continue;
      }

      const input = block.inputs[inputName];
      if (input) {
        const inputBlock = input.block || input.shadow;
        const inputCode = this.generateValue(inputBlock);
        resolvedCode = resolvedCode.replace(new RegExp(`\\b${inputName}\\b`, 'g'), inputCode);
      }
    }

    return resolvedCode;
  }

  /**
   * Create a proxy object that mimics Blockly's block API for generators
   */
  private createBlockProxy(block: BlocklyBlock): BlockProxy {
    return {
      getFieldValue: (name: string) => block.fields?.[name],
      getInputTargetBlock: (name: string) => {
        const input = block.inputs?.[name];
        const targetBlock = input?.block || input?.shadow;
        return targetBlock ? this.createBlockProxy(targetBlock) : null;
      },
      type: block.type,
      id: block.id,
    };
  }

  /**
   * Validate the generated code syntax
   */
  validateSyntax(code: string): { valid: boolean; error?: string } {
    try {
      // Wrap in async function to allow await if needed
      const wrappedCode = `
        (async function evaluate(context) {
          ${code}
        })
      `;

      // Try to parse the code
      new Function(wrappedCode);

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown syntax error',
      };
    }
  }
}
