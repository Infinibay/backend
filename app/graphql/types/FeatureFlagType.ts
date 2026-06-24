import { ObjectType, Field } from 'type-graphql'

@ObjectType()
export class FeatureFlagType {
  /** Stable flag key, e.g. 'storage'. */
  @Field()
    key!: string

  @Field()
    label!: string

  @Field()
    description!: string

  @Field()
    enabled!: boolean
}
