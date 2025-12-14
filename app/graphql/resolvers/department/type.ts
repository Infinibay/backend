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

  @Field({ nullable: true })
    bridgeName?: string

  @Field({ nullable: true })
    gatewayIP?: string
}

@InputType()
export class UpdateDepartmentNameInput {
  @Field(() => ID)
    id: string = ''

  @Field(() => String)
    name: string = ''
}
