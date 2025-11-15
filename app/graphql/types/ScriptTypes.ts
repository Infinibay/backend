import { ObjectType, Field, ID, InputType, Int, registerEnumType } from 'type-graphql';
import GraphQLJSONObject from 'graphql-type-json';
import { OS, ShellType, ExecutionType, ExecutionStatus, ScriptAuditAction } from '@prisma/client';
import { UserType } from '../resolvers/user/type';
import { DepartmentType } from '../resolvers/department/type';

// Register Prisma enums with GraphQL
registerEnumType(OS, {
  name: 'OS',
  description: 'Operating system'
});

registerEnumType(ShellType, {
  name: 'ShellType',
  description: 'Shell type for script execution'
});

registerEnumType(ExecutionType, {
  name: 'ExecutionType',
  description: 'Script execution trigger type'
});

registerEnumType(ExecutionStatus, {
  name: 'ExecutionStatus',
  description: 'Script execution status'
});

registerEnumType(ScriptAuditAction, {
  name: 'ScriptAuditAction',
  description: 'Script audit action type'
});

// Script format enum
export enum ScriptFormat {
  YAML = 'yaml',
  JSON = 'json'
}

registerEnumType(ScriptFormat, {
  name: 'ScriptFormat',
  description: 'Script file format'
});

// Schedule type enum
export enum ScheduleType {
  IMMEDIATE = 'IMMEDIATE',
  ONE_TIME = 'ONE_TIME',
  PERIODIC = 'PERIODIC'
}

registerEnumType(ScheduleType, {
  name: 'ScheduleType',
  description: 'Script schedule type'
});

// Machine type (minimal, for references)
@ObjectType()
export class MachineType {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field()
  status!: string;

  @Field()
  os!: string;

  @Field(() => DepartmentType, { nullable: true })
  department?: DepartmentType;
}

// Input option for select/multiselect inputs
@ObjectType()
export class InputOptionType {
  @Field()
  label!: string;

  @Field()
  value!: string;
}

// Script input definition
@ObjectType()
export class ScriptInputType {
  @Field()
  name!: string;

  @Field()
  type!: string;

  @Field()
  label!: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => GraphQLJSONObject, { nullable: true })
  default?: any;

  @Field()
  required!: boolean;

  @Field(() => GraphQLJSONObject, { nullable: true })
  validation?: any;

  @Field(() => [InputOptionType], { nullable: true })
  options?: InputOptionType[];
}

// Script type
@ObjectType()
export class ScriptType {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field({ nullable: true })
  description?: string;

  @Field()
  fileName!: string;

  @Field({ nullable: true })
  category?: string;

  @Field(() => [String])
  tags!: string[];

  @Field(() => [OS])
  os!: OS[];

  @Field(() => ShellType)
  shell!: ShellType;

  @Field()
  hasInputs!: boolean;

  @Field(() => Int)
  inputCount!: number;

  @Field({ nullable: true })
  content?: string;

  @Field(() => [ScriptInputType])
  parsedInputs!: ScriptInputType[];

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;

  @Field(() => UserType, { nullable: true })
  createdBy?: UserType;

  @Field(() => Int, { nullable: true })
  executionCount?: number;

  @Field(() => Int, { nullable: true })
  departmentCount?: number;
}

// Script execution type
@ObjectType()
export class ScriptExecutionType {
  @Field(() => ID)
  id!: string;

  @Field(() => ScriptType)
  script!: ScriptType;

  @Field(() => MachineType)
  machine!: MachineType;

  @Field(() => ExecutionType)
  executionType!: ExecutionType;

  @Field(() => UserType, { nullable: true })
  triggeredBy?: UserType;

  @Field(() => GraphQLJSONObject, { defaultValue: null })
  inputValues?: Record<string, any>;

  @Field(() => ExecutionStatus)
  status!: ExecutionStatus;

  @Field({ nullable: true })
  startedAt?: Date;

  @Field({ nullable: true })
  completedAt?: Date;

  @Field(() => Int, { nullable: true })
  exitCode?: number;

  @Field({ nullable: true })
  stdout?: string;

  @Field({ nullable: true })
  stderr?: string;

  @Field({ nullable: true })
  error?: string;

  @Field({ nullable: true })
  executedAs?: string;

  @Field()
  createdAt!: Date;

  // Scheduling fields
  @Field({ nullable: true })
  scheduledFor?: Date;

  @Field(() => Int, { nullable: true })
  repeatIntervalMinutes?: number;

  @Field({ nullable: true })
  lastExecutedAt?: Date;

  @Field(() => Int, { defaultValue: 0 })
  executionCount!: number;

  @Field(() => Int, { nullable: true })
  maxExecutions?: number;
}

// Scheduled script type (extends ScriptExecutionType with computed fields)
@ObjectType()
export class ScheduledScriptType extends ScriptExecutionType {
  @Field(() => ScheduleType)
  scheduleType!: ScheduleType;

  @Field({ nullable: true })
  nextExecutionAt?: Date;

  @Field()
  isActive!: boolean;
}

// Script response type (for mutations)
@ObjectType()
export class ScriptResponseType {
  @Field()
  success!: boolean;

  @Field({ nullable: true })
  message?: string;

  @Field({ nullable: true })
  error?: string;

  @Field(() => ScriptType, { nullable: true })
  script?: ScriptType;
}

// Script execution response type (for mutations)
@ObjectType()
export class ScriptExecutionResponseType {
  @Field()
  success!: boolean;

  @Field({ nullable: true })
  message?: string;

  @Field({ nullable: true })
  error?: string;

  @Field(() => ScriptExecutionType, { nullable: true })
  execution?: ScriptExecutionType;
}

/**
 * Paginated response type for script executions query
 * Includes total count and pagination metadata
 */
@ObjectType()
export class ScriptExecutionsResponseType {
  @Field(() => [ScriptExecutionType])
  executions!: ScriptExecutionType[];

  @Field(() => Int)
  total!: number;

  @Field()
  hasMore!: boolean;

  @Field(() => Int)
  offset!: number;

  @Field(() => Int)
  limit!: number;
}

// Schedule script response type
@ObjectType()
export class ScheduleScriptResponseType {
  @Field()
  success!: boolean;

  @Field({ nullable: true })
  message?: string;

  @Field({ nullable: true })
  error?: string;

  @Field(() => [ID], { nullable: true })
  executionIds?: string[];

  @Field(() => [ScheduledScriptType], { nullable: true })
  executions?: ScheduledScriptType[];

  @Field(() => [String], { nullable: true })
  warnings?: string[];
}

// Input types for mutations

@InputType()
export class CreateScriptInput {
  @Field()
  name!: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true })
  category?: string;

  @Field(() => [String], { nullable: true })
  tags?: string[];

  @Field()
  content!: string;

  @Field(() => ScriptFormat)
  format!: ScriptFormat;
}

@InputType()
export class UpdateScriptInput {
  @Field(() => ID)
  id!: string;

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true })
  category?: string;

  @Field(() => [String], { nullable: true })
  tags?: string[];

  @Field({ nullable: true })
  content?: string;
}

@InputType()
export class ExecuteScriptInput {
  @Field(() => ID)
  scriptId!: string;

  @Field(() => ID)
  machineId!: string;

  @Field(() => GraphQLJSONObject, { defaultValue: null })
  inputValues?: Record<string, any>;

  @Field({ nullable: true })
  runAs?: string; // "system", "administrator", or username
}

@InputType()
export class ScriptFiltersInput {
  @Field({ nullable: true })
  category?: string;

  @Field(() => OS, { nullable: true })
  os?: OS;

  @Field(() => [String], { nullable: true })
  tags?: string[];

  @Field({ nullable: true })
  search?: string;
}

/**
 * Input type for filtering and paginating script executions
 * Supports filtering by script, machine, department, status, execution type, and date range
 * Either scriptId, machineId, or departmentId should be provided for efficient querying
 */
@InputType()
export class ScriptExecutionsFiltersInput {
  @Field(() => ID, { nullable: true })
  scriptId?: string;

  @Field(() => ID, { nullable: true })
  machineId?: string;

  @Field(() => ID, { nullable: true })
  departmentId?: string;

  @Field(() => ExecutionStatus, { nullable: true })
  status?: ExecutionStatus;

  @Field(() => ExecutionType, { nullable: true })
  executionType?: ExecutionType;

  @Field({ nullable: true })
  startDate?: Date;

  @Field({ nullable: true })
  endDate?: Date;

  @Field(() => Int, { defaultValue: 50 })
  limit: number = 50;

  @Field(() => Int, { defaultValue: 0 })
  offset: number = 0;
}

// Schedule script input
@InputType()
export class ScheduleScriptInput {
  @Field(() => ID)
  scriptId!: string;

  @Field(() => [ID], { nullable: true })
  machineIds?: string[]; // For specific VMs

  @Field(() => ID, { nullable: true })
  departmentId?: string; // For department-wide scheduling

  @Field(() => GraphQLJSONObject)
  inputValues!: Record<string, any>;

  @Field(() => ScheduleType)
  scheduleType!: ScheduleType;

  @Field({ nullable: true })
  scheduledFor?: Date; // Required for ONE_TIME

  @Field(() => Int, { nullable: true })
  repeatIntervalMinutes?: number; // Required for PERIODIC

  @Field(() => Int, { nullable: true })
  maxExecutions?: number; // Optional, for PERIODIC

  @Field({ nullable: true })
  runAs?: string; // Optional execution user
}

// Update scheduled script input
@InputType()
export class UpdateScheduledScriptInput {
  @Field(() => ID)
  executionId!: string;

  @Field({ nullable: true })
  scheduledFor?: Date;

  @Field(() => Int, { nullable: true })
  repeatIntervalMinutes?: number;

  @Field(() => Int, { nullable: true })
  maxExecutions?: number;

  @Field(() => GraphQLJSONObject, { nullable: true })
  inputValues?: Record<string, any>;

  @Field({ nullable: true })
  runAs?: string;
}

// Scheduled scripts filters input
@InputType()
export class ScheduledScriptsFiltersInput {
  @Field(() => ID, { nullable: true })
  machineId?: string;

  @Field(() => ID, { nullable: true })
  departmentId?: string;

  @Field(() => ID, { nullable: true })
  scriptId?: string;

  @Field(() => [ExecutionStatus], { nullable: true })
  status?: ExecutionStatus[];

  @Field(() => ScheduleType, { nullable: true })
  scheduleType?: ScheduleType;

  @Field(() => Int, { nullable: true, defaultValue: 50 })
  limit?: number;
}
