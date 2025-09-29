import { ObjectType, Field, Int, ID, InputType, registerEnumType } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'
import { OrderByDirection } from '@utils/pagination'
import { MachineTemplateType } from '@resolvers/machine_template/type'
import { UserType } from '@resolvers/user/type'
import { DepartmentType } from '../department/type'
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

    @Field(() => String)
      internalName: string = ''

    @Field(() => String)
      os: string = ''

    @Field(() => Int, { nullable: true })
      cpuCores: number | null = null

    @Field(() => Int, { nullable: true })
      ramGB: number | null = null

    @Field(() => Int, { nullable: true })
      diskSizeGB: number | null = null

    @Field(() => String, { nullable: true })
      gpuPciAddress: string | null = null

    @Field(() => String, { nullable: true })
      localIP: string | null = null

    @Field(() => String, { nullable: true })
      publicIP: string | null = null

    @Field(() => GraphQLJSONObject, { nullable: true })
      configuration: Record<string, unknown> | null = null

    @Field(() => String)
      status: MachineStatus = MachineStatus.STOPPED

    @Field(() => String, { nullable: true })
      userId: string | null = null

    @Field(() => String, { nullable: true })
      templateId: string | null = null

    @Field(() => Date, { nullable: true })
      createdAt: Date | null = null

    @Field(() => MachineTemplateType, { nullable: true })
      template?: MachineTemplateType

    @Field(() => String, { nullable: true })
      departmentId: string | null = null

    @Field(() => DepartmentType, { nullable: true })
      department?: DepartmentType

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
export class GraphicConfigurationType {
    @Field(() => String)
      link: string = ''

    @Field(() => String)
      password: string = ''

    @Field(() => String)
      protocol: string = ''
}

@ObjectType()
export class SuccessType {
    @Field(() => Boolean)
      success: boolean = false

    @Field(() => String)
      message: string = ''
}

@ObjectType()
export class CommandExecutionResponseType {
    @Field(() => Boolean)
      success: boolean = false

    @Field(() => String)
      message: string = ''

    @Field(() => String, { nullable: true })
      response?: string
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

    @Field(() => GraphQLJSONObject, { nullable: true })
      parameters?: Record<string, unknown> | null
}

@InputType()
export class CreateMachineInputType {
    @Field(() => String, { nullable: true })
      templateId?: string

    @Field(() => ID, { nullable: true }) // Temporarly is nullable, but it should not
      departmentId: string = ''

    @Field()
      name: string = ''

    @Field(() => OsEnum)
      os: OsEnum = OsEnum.WINDOWS10

    @Field()
      username: string = ''

    @Field()
      password: string = ''

    @Field(() => String, { nullable: true })
      productKey?: string | undefined

    @Field(() => String, { nullable: true })
      pciBus: string | null = null

    @Field(() => [MachineApplicationInputType])
      applications: MachineApplicationInputType[] = []

    @Field(() => Int, { nullable: true })
      customCores?: number

    @Field(() => Int, { nullable: true })
      customRam?: number

    @Field(() => Int, { nullable: true })
      customStorage?: number
}

@InputType()
export class UpdateMachineHardwareInput {
    @Field(() => ID)
      id: string = '' // ID of the machine to update

    @Field(() => Int, { nullable: true, description: 'New number of CPU cores' })
      cpuCores?: number

    @Field(() => Int, { nullable: true, description: 'New RAM in GB' })
      ramGB?: number

    @Field(() => String, { nullable: true, description: 'New GPU PCI address (e.g., 0000:01:00.0). Set to null to remove GPU.' })
      gpuPciAddress?: string | null
}

@InputType()
export class UpdateMachineNameInput {
    @Field(() => ID)
      id: string = '' // ID of the machine to update

    @Field(() => String, { description: 'New name for the machine' })
      name: string = ''
}
