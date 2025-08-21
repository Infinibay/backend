import { ObjectType, Field, ID, InputType } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'

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

  @Field(() => GraphQLJSONObject)
    installCommand!: Record<string, string>

  @Field(() => GraphQLJSONObject, { nullable: true })
    parameters?: any = null
}
