import { ObjectType, Field, ID, InputType } from 'type-graphql'

@ObjectType()
export class AppSettings {
  @Field(() => ID)
    id!: string

  @Field()
    theme!: string // 'light', 'dark', 'system'

  @Field()
    wallpaper!: string

  @Field(() => String, { nullable: true })
    logoUrl?: string | null

  @Field()
    interfaceSize!: string // 'sm', 'md', 'lg', 'xl'

  @Field(() => String, { nullable: true })
    brandName?: string | null

  @Field(() => String, { nullable: true })
    themePreset?: string | null // named preset id, e.g. 'violet', 'emerald'

  @Field(() => String, { nullable: true })
    accentColor?: string | null // hex or 'r g b'

  @Field(() => String, { nullable: true })
    accent2Color?: string | null

  @Field(() => String, { nullable: true })
    accent3Color?: string | null

  @Field()
    createdAt!: Date

  @Field()
    updatedAt!: Date
}

@InputType()
export class AppSettingsInput {
  @Field(() => String, { nullable: true })
    theme?: string

  @Field(() => String, { nullable: true })
    wallpaper?: string

  @Field(() => String, { nullable: true })
    logoUrl?: string

  @Field(() => String, { nullable: true })
    interfaceSize?: string

  @Field(() => String, { nullable: true })
    brandName?: string

  @Field(() => String, { nullable: true })
    themePreset?: string

  @Field(() => String, { nullable: true })
    accentColor?: string

  @Field(() => String, { nullable: true })
    accent2Color?: string

  @Field(() => String, { nullable: true })
    accent3Color?: string
}
