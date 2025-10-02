import { ObjectType, Field, ID, Int, InputType } from 'type-graphql'

@ObjectType()
export class DepartmentType {
  @Field(() => ID)
    id: string = ''

  @Field()
    name: string = ''

  @Field()
    createdAt: Date = new Date()

  @Field(() => Int, { nullable: true })
    internetSpeed?: number

  @Field({ nullable: true })
    ipSubnet?: string

  @Field(() => Number, { nullable: true })
    totalMachines?: number
}

@InputType()
export class UpdateDepartmentNameInput {
  @Field(() => ID)
    id: string = ''

  @Field(() => String)
    name: string = ''
}
