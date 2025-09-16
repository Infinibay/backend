import { ObjectType, Field, ID, InputType, registerEnumType, Int } from 'type-graphql'

/**
 * Predefined firewall template configurations for common use cases.
 * Templates provide pre-configured rule sets for typical server roles.
 */
export enum FirewallTemplate {
  /** Web server configuration with HTTP/HTTPS ports open */
  WEB_SERVER = 'WEB_SERVER',
  /** Database server configuration with common database ports */
  DATABASE = 'DATABASE',
  /** Desktop configuration with RDP and common desktop ports */
  DESKTOP = 'DESKTOP',
  /** Development environment with common development ports */
  DEVELOPMENT = 'DEVELOPMENT'
}

registerEnumType(FirewallTemplate, {
  name: 'FirewallTemplate',
  description: 'Predefined firewall template configurations for common use cases'
})

/**
 * Types of port configurations supported in advanced firewall rules.
 * Determines how the port value should be interpreted and validated.
 */
export enum PortInputType {
  /** Single port number (e.g., "80") */
  SINGLE = 'SINGLE',
  /** Port range (e.g., "8080-8090") */
  RANGE = 'RANGE',
  /** Multiple ports or ranges (e.g., "80,443,8080-8090") */
  MULTIPLE = 'MULTIPLE',
  /** All ports (special value "all") */
  ALL = 'ALL'
}

registerEnumType(PortInputType, {
  name: 'PortInputType',
  description: 'Types of port configurations supported in advanced firewall rules'
})

/**
 * Represents a simplified firewall rule with basic configuration.
 * Used for both template rules and custom rules.
 */
@ObjectType()
export class SimplifiedFirewallRule {
  /** Unique identifier for the rule */
  @Field(() => ID, { nullable: true, description: 'Unique rule identifier' })
    id?: string

  /** Port specification (number, range, or "all") */
  @Field(() => String, { description: 'Port specification (e.g., "80", "80-90", "all")' })
    port!: string

  /** Network protocol */
  @Field({ description: 'Network protocol (tcp, udp, icmp)' })
    protocol!: string

  /** Traffic direction */
  @Field({ description: 'Traffic direction (in, out, inout)' })
    direction!: string

  /** Firewall action */
  @Field({ description: 'Firewall action (accept, drop, reject)' })
    action!: string

  /** Optional rule description */
  @Field({ nullable: true, description: 'Rule description' })
    description?: string

  /** Sources that created this rule (templates or custom) */
  @Field(() => [String], { nullable: true, description: 'Rule sources (templates or custom)' })
    sources?: string[]
}

/**
 * Complete firewall state for a virtual machine.
 * Includes applied templates, custom rules, and effective rules.
 */
@ObjectType()
export class VMFirewallState {
  /** List of applied firewall templates */
  @Field(() => [String], { description: 'Applied firewall templates' })
    appliedTemplates!: string[]

  /** Custom firewall rules created by user */
  @Field(() => [SimplifiedFirewallRule], { description: 'Custom firewall rules' })
    customRules!: SimplifiedFirewallRule[]

  /** All effective rules (templates + custom, optimized) */
  @Field(() => [SimplifiedFirewallRule], { description: 'All effective firewall rules' })
    effectiveRules!: SimplifiedFirewallRule[]

  /** Last synchronization with libvirt */
  @Field(() => Date, { nullable: true, description: 'Last sync with hypervisor' })
    lastSync!: Date | null
}

/**
 * Information about a firewall template including its rules.
 * Provides metadata and rule preview for template selection.
 */
@ObjectType()
export class FirewallTemplateInfo {
  /** Template name identifier */
  @Field({ description: 'Template name identifier' })
    name!: string

  /** Human-readable template description */
  @Field({ description: 'Human-readable template description' })
    description!: string

  /** List of rules included in this template */
  @Field(() => [SimplifiedFirewallRule], { description: 'List of rules included in this template' })
    rules!: SimplifiedFirewallRule[]
}

/**
 * Input for creating simplified firewall rules with basic configuration.
 * Used for legacy simplified rule creation.
 */
@InputType()
export class SimplifiedFirewallRuleInput {
  /** Port specification string */
  @Field({ description: 'Port specification (e.g., "80", "443", "8080-8090")' })
    port!: string

  /** Port type for advanced validation (optional for backward compatibility) */
  @Field(() => PortInputType, { nullable: true, description: 'Port type for validation (optional)' })
    portType?: PortInputType

  /** Network protocol */
  @Field({ description: 'Network protocol (tcp, udp, icmp)' })
    protocol!: string

  /** Traffic direction */
  @Field({ description: 'Traffic direction (in, out, inout)' })
    direction!: string

  /** Firewall action */
  @Field({ defaultValue: 'accept', description: 'Firewall action (accept, drop, reject)' })
    action!: string

  /** Optional rule description */
  @Field({ nullable: true, description: 'Optional rule description' })
    description?: string
}

/**
 * Input for creating simplified firewall rules via mutation.
 * Includes machine ID and basic rule configuration.
 */
@InputType()
export class CreateSimplifiedFirewallRuleInput {
  /** ID of the virtual machine to apply the rule to */
  @Field(() => ID, { description: 'Virtual machine ID' })
    machineId!: string

  /** Port specification string */
  @Field({ description: 'Port specification (e.g., "80", "443", "all")' })
    port!: string

  /** Network protocol */
  @Field({ defaultValue: 'tcp', description: 'Network protocol (tcp, udp, icmp)' })
    protocol!: string

  /** Traffic direction */
  @Field({ defaultValue: 'in', description: 'Traffic direction (in, out, inout)' })
    direction!: string

  /** Firewall action */
  @Field({ defaultValue: 'accept', description: 'Firewall action (accept, drop, reject)' })
    action!: string

  /** Optional rule description */
  @Field({ nullable: true, description: 'Optional rule description' })
    description?: string
}

/**
 * Input for applying predefined firewall templates to a virtual machine.
 * Templates provide quick setup for common use cases.
 */
@InputType()
export class ApplyFirewallTemplateInput {
  /** ID of the virtual machine to apply the template to */
  @Field(() => ID, { description: 'Virtual machine ID' })
    machineId!: string

  /** Firewall template to apply */
  @Field(() => FirewallTemplate, { description: 'Firewall template to apply' })
    template!: FirewallTemplate
}

/**
 * Advanced port configuration input for flexible firewall rules.
 * Supports single ports, ranges, multiple ports, and combinations.
 */
@InputType()
export class AdvancedPortInput {
  /** Type of port configuration (single, range, multiple, or all) */
  @Field(() => PortInputType, { description: 'Type of port configuration' })
  type!: PortInputType

  /** Port value string (e.g., "80", "80-90", "80,443,8080", "all") */
  @Field(() => String, { description: 'Port specification string' })
  value!: string

  /** Optional description for this port configuration */
  @Field({ nullable: true, description: 'Description of the port configuration' })
  description?: string
}

/**
 * Input for creating advanced firewall rules with flexible port configurations.
 * Supports complex port specifications and automatic rule optimization.
 */
@InputType()
export class CreateAdvancedFirewallRuleInput {
  /** ID of the virtual machine to apply the rule to */
  @Field(() => ID, { description: 'Virtual machine ID' })
  machineId!: string

  /** Port configuration (supports ranges, multiple ports, etc.) */
  @Field(() => AdvancedPortInput, { description: 'Advanced port configuration' })
  ports!: AdvancedPortInput

  /** Network protocol (tcp, udp, icmp) */
  @Field({ defaultValue: 'tcp', description: 'Network protocol (tcp, udp, icmp)' })
  protocol!: string

  /** Traffic direction (in, out, inout) */
  @Field({ defaultValue: 'in', description: 'Traffic direction (in, out, inout)' })
  direction!: string

  /** Firewall action (accept, drop, reject) */
  @Field({ defaultValue: 'accept', description: 'Firewall action (accept, drop, reject)' })
  action!: string

  /** Optional description for the firewall rule */
  @Field({ nullable: true, description: 'Optional rule description' })
  description?: string
}

/**
 * Result of port validation operation.
 * Indicates validity and provides error details or parsed ranges.
 */
@ObjectType()
export class PortValidationResult {
  /** Whether the port specification is valid */
  @Field(() => Boolean, { description: 'Whether the port specification is valid' })
  isValid!: boolean

  /** List of validation errors if invalid */
  @Field(() => [String], { description: 'List of validation errors if invalid' })
  errors!: string[]

  /** Parsed port ranges if valid */
  @Field(() => [PortRange], { nullable: true, description: 'Parsed port ranges if valid' })
  parsedRanges?: PortRange[]
}

/**
 * Represents a port range with start and end values.
 * Used for port validation and rule optimization.
 */
@ObjectType()
export class PortRange {
  /** Starting port number (1-65535) */
  @Field(() => Int, { description: 'Starting port number (1-65535)' })
  start!: number

  /** Ending port number (1-65535) */
  @Field(() => Int, { description: 'Ending port number (1-65535)' })
  end!: number

  /** Optional description for this port range */
  @Field({ nullable: true, description: 'Optional description for this port range' })
  description?: string
}

