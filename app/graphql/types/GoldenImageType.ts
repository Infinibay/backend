import { ObjectType, Field, ID, InputType, registerEnumType, Int } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum GoldenImageStatus {
  BUILDING = 'building',
  DRAFT = 'draft',
  PUBLISHED = 'published',
  DEPRECATED = 'deprecated',
  FAILED = 'failed',
}

export enum GoldenImageSourceType {
  AUTOMATED = 'automated',
  MANUAL_CAPTURE = 'manual-capture',
}

export enum GoldenImageOsType {
  WINDOWS_10 = 'windows-10',
  WINDOWS_11 = 'windows-11',
  UBUNTU = 'ubuntu',
  FEDORA = 'fedora',
}

registerEnumType(GoldenImageStatus, { name: 'GoldenImageStatus' })
registerEnumType(GoldenImageSourceType, { name: 'GoldenImageSourceType' })
registerEnumType(GoldenImageOsType, { name: 'GoldenImageOsType' })

// ---------------------------------------------------------------------------
// Object types
// ---------------------------------------------------------------------------

@ObjectType()
export class GoldenImage {
  @Field(() => ID)
    id!: string

  @Field()
    name!: string

  @Field(() => GoldenImageOsType)
    osType!: GoldenImageOsType

  @Field({ nullable: true })
    osVersion?: string

  @Field()
    baseDiskPath!: string

  // BigInt serialized as string to avoid precision loss on large images.
  @Field(() => String)
    sizeBytes!: string

  @Field(() => GoldenImageStatus)
    status!: GoldenImageStatus

  @Field(() => Int)
    version!: number

  @Field({ nullable: true })
    parentImageId?: string

  @Field(() => GoldenImageSourceType)
    sourceType!: GoldenImageSourceType

  @Field({ nullable: true })
    sourceMachineId?: string

  @Field({ nullable: true })
    sourceTemplateId?: string

  @Field(() => GraphQLJSONObject, { nullable: true })
    hardeningApplied?: Record<string, unknown>

  @Field({ nullable: true })
    notes?: string

  @Field({ nullable: true })
    createdById?: string

  @Field()
    createdAt!: Date

  @Field()
    updatedAt!: Date

  @Field({ nullable: true })
    sealedAt?: Date

  @Field({ nullable: true })
    deprecatedAt?: Date
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

@InputType()
export class CreateGoldenImageFromTemplateInput {
  @Field()
    templateId!: string

  @Field()
    name!: string

  @Field({ nullable: true })
    notes?: string

  @Field(() => GraphQLJSONObject, { nullable: true, description: 'Hardening script toggles — shape is { scriptFileName: boolean }.' })
    hardeningOptions?: Record<string, boolean>

  /**
   * When true and this build supersedes a published image of the same
   * family, the previous published image is auto-deprecated at publish
   * time. Defaults to false (operator publishes manually).
   */
  @Field({ nullable: true, defaultValue: false })
    autoDeprecatePrevious?: boolean

  @Field({ nullable: true, description: 'If set, record this build as a new version of the given family.' })
    parentImageId?: string
}

@InputType()
export class CaptureGoldenImageFromMachineInput {
  @Field()
    machineId!: string

  @Field()
    name!: string

  @Field({ nullable: true })
    notes?: string

  @Field(() => GraphQLJSONObject, { nullable: true })
    hardeningOptions?: Record<string, boolean>

  /**
   * Default true — strips user home directories / profiles during the
   * seal. Set false only when you want to preserve tuned user config
   * in the golden image (rare; see plan open-question #1).
   */
  @Field({ nullable: true, defaultValue: true })
    sanitizeUserData?: boolean

  /**
   * Default false — clones the source disk to a staging path first and
   * seals the clone, leaving the source VM usable. Set true to seal the
   * source VM's disk in-place (faster, destroys source).
   */
  @Field({ nullable: true, defaultValue: false })
    destroySource?: boolean

  @Field({ nullable: true })
    parentImageId?: string
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

@ObjectType()
export class GoldenImageResult {
  @Field()
    success!: boolean

  @Field({ nullable: true })
    image?: GoldenImage

  @Field({ nullable: true })
    error?: string
}
