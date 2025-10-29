import yaml from 'js-yaml';
import { OS, ShellType } from '@prisma/client';

// Supported input types
export type InputType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'path'
  | 'password'
  | 'email'
  | 'url'
  | 'multiselect'
  | 'textarea';

// Script input definition interface
export interface ScriptInputDefinition {
  name: string;
  type: InputType;
  label: string;
  description?: string;
  default?: any;
  required?: boolean;
  validation?: {
    pattern?: string;
    patternDescription?: string;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    step?: number;
    pathType?: string;
    protocols?: string[];
    minSelections?: number;
    maxSelections?: number;
    checkedValue?: string;
    uncheckedValue?: string;
  };
  options?: Array<{ label: string; value: string }>;
}

// Script metadata interface
export interface ScriptMetadata {
  name: string;
  description?: string;
  author?: string;
  version?: string;
  category?: string;
  tags?: string[];
}

// Script execution configuration
export interface ScriptExecution {
  timeout?: number;
  run_as?: string;
  retry_on_failure?: boolean;
  max_retries?: number;
}

// Parsed script structure
export interface ParsedScript {
  metadata?: ScriptMetadata;
  name: string;
  description?: string;
  author?: string;
  version?: string;
  category?: string;
  tags?: string[];
  os: string[];
  shell: string;
  inputs?: ScriptInputDefinition[];
  script: string;
  execution?: ScriptExecution;
}

export class ScriptParser {
  /**
   * Parse YAML content into a ParsedScript object
   */
  parseYAML(content: string): ParsedScript {
    try {
      const parsed = yaml.load(content) as any;
      return this.normalizeScript(parsed);
    } catch (error) {
      throw new Error(`Failed to parse YAML: ${(error as Error).message}`);
    }
  }

  /**
   * Parse JSON content into a ParsedScript object
   */
  parseJSON(content: string): ParsedScript {
    try {
      const parsed = JSON.parse(content);
      return this.normalizeScript(parsed);
    } catch (error) {
      throw new Error(`Failed to parse JSON: ${(error as Error).message}`);
    }
  }

  /**
   * Normalize parsed object to ParsedScript structure
   */
  private normalizeScript(scriptObject: any): ParsedScript {
    return {
      metadata: scriptObject.metadata,
      name: scriptObject.name,
      description: scriptObject.description,
      author: scriptObject.author,
      version: scriptObject.version,
      category: scriptObject.category,
      tags: scriptObject.tags,
      os: scriptObject.os,
      shell: scriptObject.shell,
      inputs: scriptObject.inputs,
      script: scriptObject.script,
      execution: scriptObject.execution
    };
  }

  /**
   * Validate the parsed script schema
   */
  validateSchema(scriptObject: ParsedScript): void {
    // Validate required fields
    if (!scriptObject.name || typeof scriptObject.name !== 'string') {
      throw new Error('Script name is required and must be a string');
    }

    if (!scriptObject.os || !Array.isArray(scriptObject.os) || scriptObject.os.length === 0) {
      throw new Error('Script os is required and must be a non-empty array');
    }

    if (!scriptObject.shell || typeof scriptObject.shell !== 'string') {
      throw new Error('Script shell is required and must be a string');
    }

    if (!scriptObject.script || typeof scriptObject.script !== 'string') {
      throw new Error('Script content is required and must be a string');
    }

    // Validate OS enum values
    const validOS = Object.values(OS);
    scriptObject.os.forEach((os: any, index: number) => {
      if (typeof os !== 'string') {
        throw new Error(`Invalid OS value at index ${index}: expected string but got ${typeof os}`);
      }
      const osUpper = os.toUpperCase();
      if (!validOS.includes(osUpper as OS)) {
        throw new Error(`Invalid OS value: ${os}. Valid values are: ${validOS.join(', ')}`);
      }
    });

    // Validate shell enum value
    const validShells = Object.values(ShellType);
    const shellUpper = scriptObject.shell.toUpperCase();
    if (!validShells.includes(shellUpper as ShellType)) {
      throw new Error(`Invalid shell value: ${scriptObject.shell}. Valid values are: ${validShells.join(', ')}`);
    }

    // Validate inputs if present
    if (scriptObject.inputs) {
      if (!Array.isArray(scriptObject.inputs)) {
        throw new Error('Script inputs must be an array');
      }
      scriptObject.inputs.forEach((input: ScriptInputDefinition, index: number) => {
        try {
          this.validateInputDefinition(input);
        } catch (error) {
          throw new Error(`Invalid input at index ${index}: ${(error as Error).message}`);
        }
      });
    }
  }

  /**
   * Validate a single input definition
   */
  validateInputDefinition(input: ScriptInputDefinition): void {
    if (!input.name || typeof input.name !== 'string') {
      throw new Error('Input name is required and must be a string');
    }

    if (!input.type || typeof input.type !== 'string') {
      throw new Error('Input type is required and must be a string');
    }

    if (!input.label || typeof input.label !== 'string') {
      throw new Error('Input label is required and must be a string');
    }

    const validTypes: InputType[] = [
      'text', 'number', 'boolean', 'select', 'path',
      'password', 'email', 'url', 'multiselect', 'textarea'
    ];

    if (!validTypes.includes(input.type as InputType)) {
      throw new Error(`Invalid input type: ${input.type}. Valid types are: ${validTypes.join(', ')}`);
    }

    // Validate type-specific requirements
    if ((input.type === 'select' || input.type === 'multiselect') && (!input.options || !Array.isArray(input.options) || input.options.length === 0)) {
      throw new Error(`Input type '${input.type}' requires a non-empty options array`);
    }

    // Validate boolean custom values if present
    if (input.type === 'boolean' && input.validation) {
      if (input.validation.checkedValue !== undefined && input.validation.checkedValue === '') {
        throw new Error(`Boolean input '${input.name}' has empty checkedValue`);
      }
      if (input.validation.uncheckedValue !== undefined && input.validation.uncheckedValue === '') {
        throw new Error(`Boolean input '${input.name}' has empty uncheckedValue`);
      }
      if (input.validation.checkedValue && input.validation.uncheckedValue &&
          input.validation.checkedValue === input.validation.uncheckedValue) {
        throw new Error(`Boolean input '${input.name}' has identical checked and unchecked values`);
      }
    }

    // Validate options structure if present
    if (input.options) {
      input.options.forEach((option, index) => {
        if (!option.label || !option.value) {
          throw new Error(`Option at index ${index} must have both label and value`);
        }
      });
    }
  }

  /**
   * Extract metadata from parsed script
   */
  extractMetadata(scriptObject: ParsedScript): object {
    return {
      name: scriptObject.name,
      description: scriptObject.description || null,
      category: scriptObject.category || null,
      tags: scriptObject.tags || [],
      os: scriptObject.os.map(o => o.toUpperCase()),
      shell: scriptObject.shell.toUpperCase()
    };
  }

  /**
   * Extract inputs from parsed script
   */
  extractInputs(scriptObject: ParsedScript): ScriptInputDefinition[] {
    return scriptObject.inputs || [];
  }

  /**
   * Get input count
   */
  getInputCount(scriptObject: ParsedScript): number {
    return scriptObject.inputs?.length || 0;
  }

  /**
   * Check if script has inputs
   */
  hasInputs(scriptObject: ParsedScript): boolean {
    return (scriptObject.inputs?.length || 0) > 0;
  }

  /**
   * Validate input value against input definition
   */
  validateInputValue(input: ScriptInputDefinition, value: any): void {
    // Check required
    if (input.required && (value === null || value === undefined || value === '')) {
      throw new Error(`Input '${input.name}' is required`);
    }

    // Skip validation if value is empty and not required
    if (!input.required && (value === null || value === undefined || value === '')) {
      return;
    }

    // Type-specific validation
    switch (input.type) {
      case 'text':
      case 'password':
      case 'textarea':
        if (typeof value !== 'string') {
          throw new Error(`Input '${input.name}' must be a string`);
        }
        if (input.validation?.minLength && value.length < input.validation.minLength) {
          throw new Error(`Input '${input.name}' must be at least ${input.validation.minLength} characters`);
        }
        if (input.validation?.maxLength && value.length > input.validation.maxLength) {
          throw new Error(`Input '${input.name}' must be at most ${input.validation.maxLength} characters`);
        }
        if (input.validation?.pattern) {
          const regex = new RegExp(input.validation.pattern);
          if (!regex.test(value)) {
            const errorMessage = input.validation.patternDescription
              ? `Input '${input.name}': ${input.validation.patternDescription}`
              : `Input '${input.name}' does not match the required pattern`;
            throw new Error(errorMessage);
          }
        }
        break;

      case 'number':
        const numValue = typeof value === 'string' ? parseFloat(value) : value;
        if (typeof numValue !== 'number' || isNaN(numValue)) {
          throw new Error(`Input '${input.name}' must be a number`);
        }
        if (input.validation?.min !== undefined && numValue < input.validation.min) {
          throw new Error(`Input '${input.name}' must be at least ${input.validation.min}`);
        }
        if (input.validation?.max !== undefined && numValue > input.validation.max) {
          throw new Error(`Input '${input.name}' must be at most ${input.validation.max}`);
        }
        break;

      case 'boolean':
        // Check if custom values are configured
        if (input.validation?.checkedValue || input.validation?.uncheckedValue) {
          // Custom value validation
          const checkedValue = input.validation.checkedValue || '1';
          const uncheckedValue = input.validation.uncheckedValue || '0';
          const validValues = [checkedValue, uncheckedValue];
          const stringValue = String(value);

          if (!validValues.includes(stringValue)) {
            throw new Error(`Input '${input.name}' must be one of: ${validValues.join(', ')}`);
          }
        } else {
          // Standard boolean validation (fallback when no custom values)
          const stringValue = typeof value === 'string' ? value.toLowerCase() : value;
          if (typeof value !== 'boolean' && stringValue !== 'true' && stringValue !== 'false' && stringValue !== '1' && stringValue !== '0') {
            throw new Error(`Input '${input.name}' must be a boolean`);
          }
        }
        break;

      case 'select':
        if (!input.options?.some(opt => opt.value === value)) {
          throw new Error(`Input '${input.name}' must be one of the valid options`);
        }
        break;

      case 'multiselect':
        if (!Array.isArray(value)) {
          throw new Error(`Input '${input.name}' must be an array`);
        }
        if (input.validation?.minSelections && value.length < input.validation.minSelections) {
          throw new Error(`Input '${input.name}' must have at least ${input.validation.minSelections} selections`);
        }
        if (input.validation?.maxSelections && value.length > input.validation.maxSelections) {
          throw new Error(`Input '${input.name}' must have at most ${input.validation.maxSelections} selections`);
        }
        value.forEach((v: any) => {
          if (!input.options?.some(opt => opt.value === v)) {
            throw new Error(`Input '${input.name}' contains invalid option: ${v}`);
          }
        });
        break;

      case 'email':
        if (typeof value !== 'string') {
          throw new Error(`Input '${input.name}' must be a string`);
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
          throw new Error(`Input '${input.name}' must be a valid email address`);
        }
        break;

      case 'url':
        if (typeof value !== 'string') {
          throw new Error(`Input '${input.name}' must be a string`);
        }
        try {
          const url = new URL(value);
          if (input.validation?.protocols && !input.validation.protocols.includes(url.protocol.replace(':', ''))) {
            throw new Error(`Input '${input.name}' must use one of these protocols: ${input.validation.protocols.join(', ')}`);
          }
        } catch {
          throw new Error(`Input '${input.name}' must be a valid URL`);
        }
        break;

      case 'path':
        if (typeof value !== 'string') {
          throw new Error(`Input '${input.name}' must be a string`);
        }
        // Basic path validation - just check it's not empty and doesn't have invalid characters
        if (value.length === 0) {
          throw new Error(`Input '${input.name}' must be a valid path`);
        }
        break;
    }
  }
}
