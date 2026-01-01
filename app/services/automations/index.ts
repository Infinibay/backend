// Automation System Services
// Backend services for the visual automation system based on Google Blockly

// Core Services
export { AutomationService } from './AutomationService';
export type { CreateAutomationInput, UpdateAutomationInput, AutomationFilters } from './AutomationService';

export { AutomationTriggerService } from './AutomationTriggerService';

export { AutomationExecutor } from './AutomationExecutor';
export type { AutomationContext, ExecutionResult } from './AutomationExecutor';

// Block System
export { BlockRegistry, getBlockRegistry } from './BlockRegistry';
export type { BlockDefinition, GeneratorFunction, BlockProxy, ToolboxCategory } from './BlockRegistry';

export { BlocklyCodeGenerator } from './BlocklyCodeGenerator';

// Support Services
export { RecommendationService } from './RecommendationService';
export type { CreateRecommendationInput, SnoozeOptions, SnoozeDuration } from './RecommendationService';

export { SystemScriptService } from './SystemScriptService';
export type { CreateSystemScriptInput, UpdateSystemScriptInput } from './SystemScriptService';

export { CustomBlockService } from './CustomBlockService';
export type { CreateCustomBlockInput, UpdateCustomBlockInput } from './CustomBlockService';
