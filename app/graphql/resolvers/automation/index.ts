// Automation System GraphQL Resolvers
// Visual automation system based on Google Blockly

export { AutomationResolver } from './resolver'

// Types
export {
  AutomationType,
  AutomationTargetType,
  AutomationScriptType,
  AutomationExecutionType,
  AutomationRecommendationType,
  SystemScriptType,
  CustomBlockType,
  CustomBlockInputType,
  BlocklyToolboxType,
  ToolboxCategoryType,
  BlockDefinitionOutputType,
  AutomationValidationResultType,
  ValidationErrorType,
  ValidationWarningType,
  TestResultType,
  AutomationEventType,
  AutomationUserType,
  AutomationDepartmentType,
  AutomationMachineType,
  AutomationScriptRefType,
  AutomationScriptExecutionType,
  AutomationSnapshotType,
  SnoozeDuration,
  AutomationEventTypeEnum,
  AutomationTemplateType
} from './types'

// Inputs
export {
  CreateAutomationInput,
  UpdateAutomationInput,
  AutomationFiltersInput,
  AutomationExecutionFiltersInput,
  LinkScriptToAutomationInput,
  CreateCustomBlockInput,
  UpdateCustomBlockInput,
  CustomBlockInputDef,
  RecommendationFiltersInput,
  CreateSystemScriptInput,
  UpdateSystemScriptInput
} from './inputs'
