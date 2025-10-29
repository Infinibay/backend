import { ObjectType, Field, ID, InputType, Int, registerEnumType } from 'type-graphql';
import GraphQLJSONObject from 'graphql-type-json';
import { OS, ShellType, ExecutionType, ExecutionStatus, ScriptAuditAction } from '@prisma/client';
import { UserType } from '../resolvers/user/type';

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
