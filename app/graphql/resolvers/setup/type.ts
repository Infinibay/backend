import { ObjectType, Field, Int, ID, InputType, registerEnumType } from 'type-graphql';
import { OrderByDirection } from '@utils/pagination'

@ObjectType()
export class DyummyType {
  @Field(() => String)
  value: string = ''
}
