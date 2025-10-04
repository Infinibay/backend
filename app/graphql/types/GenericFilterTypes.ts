import { ObjectType, Field, ID } from 'type-graphql'
import { GenericFilter } from '../resolvers/firewall/types'

@ObjectType()
export class AssignedGenericFilter {
  @Field(() => GenericFilter)
  filter!: GenericFilter

  @Field(() => Boolean)
  isInherited!: boolean

  @Field(() => String, { nullable: true })
  inheritedFrom!: string | null

  @Field(() => ID, { nullable: true })
  inheritedFromId!: string | null
}
