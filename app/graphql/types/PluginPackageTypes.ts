import { ObjectType, Field, ID, Int } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'

/**
 * Checker within a plugin package that can generate recommendations
 */
@ObjectType('PackageCheckerType', {
  description: 'Health checker within a plugin package'
})
export class PackageCheckerType {
  @Field(() => ID)
    id!: string

  @Field()
    name!: string

  @Field({ description: 'Type of recommendations this checker generates' })
    type!: string

  @Field(() => [String], { description: 'Data needs for this checker (e.g., diskMetrics, historicalMetrics)' })
    dataNeeds!: string[]

  @Field()
    isEnabled!: boolean
}

/**
 * Plugin package that provides extended functionality
 */
@ObjectType('PackageType', {
  description: 'Plugin package that provides extended health checking functionality'
})
export class PackageType {
  @Field(() => ID)
    id!: string

  @Field({ description: 'Unique package identifier (lowercase with dashes)' })
    name!: string

  @Field({ description: 'Semantic version (e.g., 1.0.0)' })
    version!: string

  @Field({ description: 'Human-readable name for display' })
    displayName!: string

  @Field({ nullable: true, description: 'Package description' })
    description?: string

  @Field({ description: 'Package author or organization' })
    author!: string

  @Field({ description: 'License type: open-source or commercial' })
    license!: string

  @Field({ description: 'Whether this is a built-in package' })
    isBuiltin!: boolean

  @Field({ description: 'Whether the package is currently enabled' })
    isEnabled!: boolean

  @Field(() => GraphQLJSONObject, { nullable: true, description: 'Package capabilities configuration' })
    capabilities?: Record<string, unknown>

  @Field({ description: 'When the package was installed' })
    installedAt!: Date

  @Field({ description: 'Last update timestamp' })
    updatedAt!: Date

  @Field(() => [PackageCheckerType], { description: 'Checkers provided by this package' })
    checkers!: PackageCheckerType[]
}

/**
 * Runtime status of a plugin package
 */
@ObjectType('PackageStatusType', {
  description: 'Runtime status of a loaded plugin package'
})
export class PackageStatusType {
  @Field({ description: 'Package name' })
    name!: string

  @Field({ description: 'Package version' })
    version!: string

  @Field({ description: 'Whether the package is loaded in memory' })
    isLoaded!: boolean

  @Field({ description: 'Whether the package is enabled' })
    isEnabled!: boolean

  @Field({ description: 'Whether this is a built-in package' })
    isBuiltin!: boolean

  @Field(() => Int, { description: 'Number of checkers in this package' })
    checkerCount!: number

  @Field({ nullable: true, description: 'Last error message if any' })
    lastError?: string
}
