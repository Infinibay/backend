import { ObjectType, Field, ID, Float } from 'type-graphql'

@ObjectType()
export class ISO {
  @Field(() => ID)
    id!: string

  @Field()
    filename!: string

  @Field()
    os!: string

  @Field(() => String, { nullable: true })
    version?: string | null

  @Field(() => String)
    size!: string // BigInt serialized as string

  @Field()
    uploadedAt!: Date

  @Field(() => Date, { nullable: true })
    lastVerified?: Date | null

  @Field()
    isAvailable!: boolean

  @Field(() => String, { nullable: true })
    checksum?: string | null

  @Field(() => String, { nullable: true })
    downloadUrl?: string | null

  @Field()
    path!: string

  @Field()
    createdAt!: Date

  @Field()
    updatedAt!: Date
}

@ObjectType()
export class ISOStatus {
  @Field()
    os!: string

  @Field()
    available!: boolean

  @Field(() => ISO, { nullable: true })
    iso?: ISO
}

@ObjectType()
export class SystemReadiness {
  @Field()
    ready!: boolean

  @Field(() => [String])
    availableOS!: string[]

  @Field(() => [String])
    missingOS!: string[]
}

@ObjectType()
export class ISOAvailabilityMap {
  @Field()
    os!: string

  @Field()
    available!: boolean
}

@ObjectType()
export class IsoDownloadStatus {
  @Field()
    os!: string

  /** idle | resolving | downloading | verifying | registering | done | failed | cancelled */
  @Field()
    state!: string

  // Float (not Int): a multi-GB ISO exceeds the 32-bit Int range.
  @Field(() => Float)
    receivedBytes!: number

  @Field(() => Float)
    totalBytes!: number

  @Field(() => String, { nullable: true })
    error?: string | null
}
