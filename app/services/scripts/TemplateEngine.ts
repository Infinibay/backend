import { ScriptInputDefinition } from './ScriptParser';

export class TemplateEngine {
  /**
   * Interpolate template variables in script content with input values
   * Template syntax: ${{ inputs.variableName }}
   */
  interpolate(scriptContent: string, inputValues: Record<string, any>): string {
    const regex = /\${{\s*inputs\.(\w+)\s*}}/g;

    return scriptContent.replace(regex, (match, variableName) => {
      if (!(variableName in inputValues)) {
        throw new Error(`Missing required input value for variable: ${variableName}`);
      }

      const value = inputValues[variableName];

      // Convert value to string
      if (value === null || value === undefined) {
        return '';
      }

      if (typeof value === 'boolean') {
        return value.toString();
      }

      if (Array.isArray(value)) {
        return value.join(',');
      }

      if (typeof value === 'object') {
        return JSON.stringify(value);
      }

      return String(value);
    });
  }

  /**
   * Validate that all required inputs are present in inputValues
   */
  validateRequiredInputs(inputs: ScriptInputDefinition[], inputValues: Record<string, any>): void {
    const missingInputs: string[] = [];

    inputs.forEach(input => {
      if (input.required) {
        if (!(input.name in inputValues)) {
          missingInputs.push(input.name);
        } else {
          const value = inputValues[input.name];
          if (value === null || value === undefined || value === '') {
            missingInputs.push(input.name);
          }
        }
      }
    });

    if (missingInputs.length > 0) {
      throw new Error(`Missing required inputs: ${missingInputs.join(', ')}`);
    }
  }

  /**
   * Extract all template variable names from script content
   */
  extractTemplateVariables(scriptContent: string): string[] {
    const regex = /\${{\s*inputs\.(\w+)\s*}}/g;
    const variables = new Set<string>();

    let match;
    while ((match = regex.exec(scriptContent)) !== null) {
      variables.add(match[1]);
    }

    return Array.from(variables);
  }

  /**
   * Validate that all template variables have corresponding input definitions
   */
  validateTemplateVariables(scriptContent: string, inputs: ScriptInputDefinition[]): void {
    const templateVariables = this.extractTemplateVariables(scriptContent);
    const inputNames = new Set(inputs.map(input => input.name));

    const undefinedVariables = templateVariables.filter(variable => !inputNames.has(variable));

    if (undefinedVariables.length > 0) {
      throw new Error(`Script uses undefined input variables: ${undefinedVariables.join(', ')}`);
    }
  }

  /**
   * Sanitize input values for password fields (used in logging)
   * Never log password values - replace with ***
   */
  sanitizeForLogging(inputValues: Record<string, any>, inputs: ScriptInputDefinition[]): Record<string, any> {
    const sanitized: Record<string, any> = {};

    inputs.forEach(input => {
      if (input.name in inputValues) {
        if (input.type === 'password') {
          sanitized[input.name] = '***';
        } else {
          sanitized[input.name] = inputValues[input.name];
        }
      }
    });

    return sanitized;
  }
}
