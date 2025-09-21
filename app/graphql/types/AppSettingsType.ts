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
}
