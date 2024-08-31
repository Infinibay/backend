import { ObjectType, Field, Int, ID, InputType, registerEnumType } from 'type-graphql';
import { OrderByDirection } from '@utils/pagination'

@ObjectType()
export class MachineTemplateType {
  @Field(() => ID)
  id: string = ''

  @Field(() => String, { nullable: true })
  name: string | null = null

  @Field(() => String, { nullable: true })
  description: string | null = null

  @Field(() => Int)
  cores: number = 0

  @Field(() => Int)
  ram: number = 0

  @Field(() => Int)
  storage: number = 0

  @Field(() => Date)
  createdAt: Date = new Date()
}

@InputType()
export class MachineTemplateOrderBy {
    @Field(() => MachineTemplateOrderByEnum, { nullable: true })
    fieldName: MachineTemplateOrderByEnum | undefined

    @Field(() => OrderByDirection, { nullable: true })
    direction: OrderByDirection | undefined
}

// MachineTemplateOrderByField enum
export enum MachineTemplateOrderByEnum {
    ID = 'id',
    NAME = 'name',
    CORES = 'cores',
    RAM = 'ram',
    STORAGE = 'storage',
    CREATED_AT = 'createdAt'
}

registerEnumType(MachineTemplateOrderByEnum, {
    name: 'MachineTemplateOrderByField',
    description: 'The field to order machine templates by'
})


@InputType()
export class MachineTemplateInputType {
    @Field(() => String)
    name: string = ''

    @Field(() => String)
    description: string = ''
    
    @Field(() => Int)
    cores: number = 0

    @Field(() => Int)
    ram: number = 0

    @Field(() => Int)
    storage: number = 0
}

