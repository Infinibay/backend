import { ObjectType, Field, ID, InputType } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'
import { UserInputError } from '@main/utils/errors'

// Applications live in the GLOBAL, cross-tenant catalog and their
// `installCommand` / `parameters` flow verbatim into root-run guest
// provisioning scripts (cloud-init on Linux, Windows unattend). `installCommand`
// is declared `Record<string, string>` but is exposed as a `GraphQLJSONObject`,
// so the schema does NOT enforce that shape at runtime — arbitrary nested JSON
// gets through. A malformed spec is only discovered downstream, where it crashes
// ISO/cloud-init generation for every VM that later selects the app (e.g. a
// non-string command makes `command.split(...)` throw, and a parameter key like
// `.*` / `a(` used to build a RegExp caused a SyntaxError or an over-broad
// substitution). Validate the shape here, before it is persisted, so a bad spec
// is rejected at write time instead of corrupting provisioning at run time.
const ALLOWED_INSTALL_OS = new Set(['ubuntu', 'fedora', 'redhat', 'windows'])
const MAX_INSTALL_COMMAND_LENGTH = 8192

function validateInstallCommand (value: unknown): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new UserInputError('installCommand must be an object mapping OS name to a command string')
  }
  for (const [os, command] of Object.entries(value as Record<string, unknown>)) {
    if (!ALLOWED_INSTALL_OS.has(os)) {
      throw new UserInputError(`installCommand contains an unsupported OS key: ${os}`)
    }
    if (typeof command !== 'string') {
      throw new UserInputError(`installCommand.${os} must be a string`)
    }
    if (command.length > MAX_INSTALL_COMMAND_LENGTH) {
      throw new UserInputError(`installCommand.${os} exceeds the maximum length of ${MAX_INSTALL_COMMAND_LENGTH} characters`)
    }
  }
}

function validateParameters (value: unknown): void {
  if (value === null || value === undefined) return
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new UserInputError('parameters must be a flat object of string, number or boolean values')
  }
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    // Keys become `{{key}}` placeholders substituted into the install command;
    // restrict them to a safe alphabet so they can never be interpreted as regex
    // metacharacters downstream.
    if (!/^[A-Za-z0-9_]+$/.test(key)) {
      throw new UserInputError(`parameters contains an invalid key: ${key}`)
    }
    const t = typeof val
    if (t !== 'string' && t !== 'number' && t !== 'boolean') {
      throw new UserInputError(`parameters.${key} must be a string, number or boolean`)
    }
  }
}

@ObjectType()
export class ApplicationType {
  @Field(() => ID)
    id: string = ''

  @Field(() => String)
    name: string = ''

  @Field(() => String, { nullable: true })
    description?: string

  @Field(() => [String])
    os: string[] = []

  @Field(() => GraphQLJSONObject)
    installCommand!: Record<string, string>

  @Field(() => GraphQLJSONObject, { nullable: true })
    parameters: any = null

  @Field(() => String, { nullable: true })
    icon?: string

  @Field(() => Date)
    createdAt: Date = new Date()
}

@InputType()
export class CreateApplicationInputType {
  @Field(() => String)
    name: string = ''

  @Field(() => String, { nullable: true })
    description?: string

  @Field(() => [String])
    os: string[] = []

  // `installCommand` / `parameters` are validated on assignment (via the setters
  // below) so both createApplication and updateApplication — which share this
  // input type — reject a malformed spec before it is ever persisted.
  private _installCommand!: Record<string, string>

  @Field(() => GraphQLJSONObject)
  get installCommand (): Record<string, string> {
    return this._installCommand
  }

  set installCommand (value: Record<string, string>) {
    validateInstallCommand(value)
    this._installCommand = value
  }

  private _parameters: any = null

  @Field(() => GraphQLJSONObject, { nullable: true })
  get parameters (): any {
    return this._parameters
  }

  set parameters (value: any) {
    validateParameters(value)
    this._parameters = value
  }
}
