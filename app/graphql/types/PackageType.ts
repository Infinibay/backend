import { ObjectType, Field, InputType, registerEnumType, ID } from 'type-graphql'

// Package information type
@ObjectType({ description: 'Information about a software package' })
export class PackageInfo {
  @Field(() => String, { description: 'Package name' })
  name: string = ''

  @Field(() => String, { description: 'Package version' })
  version: string = ''

  @Field(() => String, { nullable: true, description: 'Package description' })
  description?: string

  @Field(() => Boolean, { description: 'Whether the package is installed' })
  installed: boolean = false

  @Field(() => String, { nullable: true, description: 'Package publisher or vendor' })
  publisher?: string

  @Field(() => String, { nullable: true, description: 'Package source or repository' })
  source?: string
}

// Package action enum
export enum PackageAction {
  INSTALL = 'INSTALL',
  REMOVE = 'REMOVE',
  UPDATE = 'UPDATE'
}

// Register the enum with GraphQL
registerEnumType(PackageAction, {
  name: 'PackageAction',
  description: 'Available package management actions'
})

// Input type for package management operations
@InputType({ description: 'Input for package management operations' })
export class PackageManagementInput {
  @Field(() => ID, { description: 'ID of the target machine' })
  machineId: string = ''

  @Field(() => String, { description: 'Name of the package to manage' })
  packageName: string = ''

  @Field(() => PackageAction, { description: 'Action to perform on the package' })
  action: PackageAction = PackageAction.INSTALL
}

// Result type for package management operations
@ObjectType({ description: 'Result of a package management operation' })
export class PackageManagementResult {
  @Field(() => Boolean, { description: 'Whether the operation was successful' })
  success: boolean = false

  @Field(() => String, { description: 'Human-readable message about the operation' })
  message: string = ''

  @Field(() => String, { nullable: true, description: 'Standard output from the command' })
  stdout?: string

  @Field(() => String, { nullable: true, description: 'Standard error from the command' })
  stderr?: string

  @Field(() => String, { nullable: true, description: 'Error message if operation failed' })
  error?: string

  @Field(() => [PackageInfo], { nullable: true, description: 'List of packages (for list operations)' })
  packages?: PackageInfo[]
}

// Generic command result type (for compatibility with existing resolvers)
@ObjectType({ description: 'Generic command execution result' })
export class CommandResult {
  @Field(() => Boolean, { description: 'Whether the command was successful' })
  success: boolean = false

  @Field(() => String, { nullable: true, description: 'Command output' })
  output?: string

  @Field(() => String, { nullable: true, description: 'Error message if command failed' })
  error?: string

  @Field(() => String, { nullable: true, description: 'Standard output' })
  stdout?: string

  @Field(() => String, { nullable: true, description: 'Standard error' })
  stderr?: string
}