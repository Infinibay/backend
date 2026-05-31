import { ObjectType, Field } from 'type-graphql'

@ObjectType()
export class DyummyType {
  @Field(() => String)
    value: string = ''
}
