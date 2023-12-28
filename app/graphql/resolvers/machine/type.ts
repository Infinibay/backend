import { ObjectType, Field, Int, ID, InputType, registerEnumType } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'
import { OrderByDirection } from '@utils/pagination'
import { MachineTemplate } from '@resolvers/machine_template/type'
import { User } from '@resolvers/user/type'
// Create Machine type (check prisma Machine model)
/*
model Machine {
  id                 String  @id @default(uuid())
  config             Json
  status             Boolean
  userId             String
  templateId         String
  template           MachineTemplate @relation(fields: [templateId], references: [id])
  user               User            @relation(fields: [userId], references: [id])
}
*/
@ObjectType()
export class Machine {
    @Field(() => ID)
    id: string = ''

    @Field(() => GraphQLJSONObject)
    config: any = {}

    @Field(() => String)
    status: MachineStatus = MachineStatus.STOPPED

    @Field(() => String)
    userId: string = ''

    @Field(() => String)
    templateId: string = ''

    @Field(() => Date)
    createAt: Date = new Date()

    @Field(() => MachineTemplate, { nullable: true })
    template?: MachineTemplate

    @Field(() => User, { nullable: true })
    user?: User
}


@InputType()
export class MachineOrderBy {
    @Field(() => MachineOrderByEnum, { nullable: true })
    fieldName: MachineOrderByEnum | undefined

    @Field(() => OrderByDirection, { nullable: true })
    direction: OrderByDirection | undefined
}

// MachineOrderByField enum
export enum MachineOrderByEnum {
    ID = 'id',
    CONFIG = 'config',
    STATUS = 'status',
    USER_ID = 'userId',
    TEMPLATE_ID = 'templateId',
    CREATED_AT = 'createdAt'
}

export enum MachineStatus {
    RUNNING = 'running',
    STOPPED = 'stopped',
    PAUSED = 'paused'
}

registerEnumType(MachineOrderByEnum, {
    name: 'MachineOrderByField',
    description: 'The field to order machines by'
})

registerEnumType(MachineStatus, {
    name: 'MachineStatus',
    description: 'The status of the machine'
})

@InputType()
export class MachineApplicationInputType {
    @Field(() => String)
    machineId: string = ''

    @Field(() => String)
    applicationId: string = ''
}

@InputType()
export class CreateMachineInputType {
    @Field(() => String)
    templateId: string = ''

    @Field()
    name: string = ''

    @Field()
    os: string = ''

    @Field()
    username: string = ''

    @Field()
    password: string = ''

    @Field()
    productKey: string = ''

    @Field(() => [MachineApplicationInputType])
    applications: MachineApplicationInputType[] = []
}

