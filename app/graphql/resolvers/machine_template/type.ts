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

    @Field(() => ID, { nullable: true })
    categoryId: string | null = null
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
    @Field(() => String, {description: "The name of the machine template"})
    name: string = ''

    @Field(() => String, {description: "A brief description of the machine template"})
    description: string = ''

    @Field(() => Int, {description: "The number of cores for the machine"})
    cores: number = 0

    @Field(() => Int, {description: "The amount of RAM (in GB) for the machine"})
    ram: number = 0

    @Field(() => Int, {description: "The storage space (in GB) for the machine"})
    storage: number = 0

    @Field(() => ID, { nullable: true, description: "The ID of the category for the machine template"})
    categoryId: string | null = null
}
