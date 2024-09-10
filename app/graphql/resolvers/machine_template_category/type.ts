import { ObjectType, Field, ID, InputType } from 'type-graphql';

@ObjectType()
export class MachineTemplateCategoryType {
  @Field(() => ID)
  id: string = ''

  @Field(() => String)
  name: string = ''

  @Field(() => String, { nullable: true })
  description: string | null = null

  @Field(() => Date)
  createdAt: Date = new Date()
}

@InputType()
export class MachineTemplateCategoryInputType {
  @Field(() => String)
  name: string = ''

  @Field(() => String, { nullable: true })
  description: string | null = null
}