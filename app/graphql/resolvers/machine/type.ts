import { ObjectType, Field, Int, ID, InputType, registerEnumType } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'
import { OrderByDirection } from '@utils/pagination'
import { MachineTemplateType } from '@resolvers/machine_template/type'
import { UserType } from '@resolvers/user/type'
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

    @Field(() => String)
    name: string = ''

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

    @Field(() => MachineTemplateType, { nullable: true })
    template?: MachineTemplateType

    @Field(() => UserType, { nullable: true })
    user?: UserType
}

@ObjectType()
export class MachineConfigurationType {
    @Field(() => Int)
    port: number = 0

    @Field(() => String)
    address: string = ''
}


@ObjectType()
export class VncConfigurationType {
    @Field(() => String)
    link: string = ''

    @Field(() => String)
    password: string = ''
}

@ObjectType()
export class SuccessType {
    @Field(() => Boolean)
    success: boolean = false

    @Field(() => String)
    message: string = ''
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

export enum OsEnum {
    WINDOWS10 = 'windows10',
    WINDOWS11 = 'windows11',
    FEDORA = 'fedora',
    UBUNTU = 'ubuntu'
}

registerEnumType(MachineOrderByEnum, {
    name: 'MachineOrderByField',
    description: 'The field to order machines by'
})

registerEnumType(MachineStatus, {
    name: 'MachineStatus',
    description: 'The status of the machine'
})

registerEnumType(OsEnum, {
    name: 'MachineOs',
    description: 'The os of the machine'
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

    @Field(() => OsEnum)
    os: OsEnum = OsEnum.WINDOWS10

    @Field()
    username: string = ''

    @Field()
    password: string = ''

    @Field(() => String, { nullable: true })
    productKey?: string | null = null

    @Field(() => [MachineApplicationInputType])
    applications: MachineApplicationInputType[] = []
}

