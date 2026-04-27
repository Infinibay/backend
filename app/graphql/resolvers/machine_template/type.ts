import { ObjectType, Field, Int, ID, InputType, registerEnumType } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'
import { OrderByDirection } from '@utils/pagination'

@ObjectType()
export class MachineTemplateApplicationLink {
    @Field(() => ID)
      applicationId: string = ''

    @Field(() => String, { nullable: true })
      name?: string

    @Field(() => GraphQLJSONObject, { nullable: true })
      parameters?: Record<string, unknown>
}

@ObjectType()
export class MachineTemplateScriptLink {
    @Field(() => ID)
      scriptId: string = ''

    @Field(() => String, { nullable: true })
      name?: string

    @Field(() => Int)
      order: number = 0

    @Field(() => GraphQLJSONObject, { nullable: true })
      inputValues?: Record<string, unknown>
}

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

    @Field(() => Int, { nullable: true })
      totalMachines?: number

    @Field(() => String, { nullable: true })
      osType?: string | null

    @Field(() => String, { nullable: true })
      wallpaperUrl?: string | null

    @Field(() => String, { nullable: true })
      powerPlan?: string | null

    @Field(() => Boolean, { nullable: true })
      encryptDisk?: boolean

    @Field(() => [MachineTemplateApplicationLink], { nullable: true })
      applications?: MachineTemplateApplicationLink[]

    @Field(() => [MachineTemplateScriptLink], { nullable: true })
      scripts?: MachineTemplateScriptLink[]
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
export class TemplateApplicationInput {
    @Field(() => ID)
      applicationId: string = ''

    @Field(() => GraphQLJSONObject, { nullable: true })
      parameters?: Record<string, unknown>
}

@InputType()
export class TemplateScriptInput {
    @Field(() => ID)
      scriptId: string = ''

    @Field(() => Int, { nullable: true, defaultValue: 0 })
      order?: number

    @Field(() => GraphQLJSONObject, { nullable: true })
      inputValues?: Record<string, unknown>
}

@InputType()
export class MachineTemplateInputType {
    @Field(() => String, { description: 'The name of the machine template' })
      name: string = ''

    @Field(() => String, { description: 'A brief description of the machine template' })
      description: string = ''

    @Field(() => Int, { description: 'The number of cores for the machine' })
      cores: number = 0

    @Field(() => Int, { description: 'The amount of RAM (in GB) for the machine' })
      ram: number = 0

    @Field(() => Int, { description: 'The storage space (in GB) for the machine' })
      storage: number = 0

    @Field(() => ID, { nullable: true, description: 'The ID of the category for the machine template' })
      categoryId: string | null = null

    @Field(() => String, { nullable: true, description: "Canonical OS key: 'windows10' | 'windows11' | 'ubuntu' | 'fedora'. Required by the UI for new blueprints." })
      osType?: string | null

    @Field(() => String, { nullable: true, description: 'Desktop wallpaper path/URL applied on first boot.' })
      wallpaperUrl?: string | null

    @Field(() => String, { nullable: true, description: "Power plan token: 'balanced' | 'high-performance' | 'power-saver'." })
      powerPlan?: string | null

    @Field(() => Boolean, { nullable: true, description: 'Enable full-disk encryption (BitLocker on Windows, LUKS on Linux — LUKS is not yet wired).' })
      encryptDisk?: boolean

    @Field(() => [TemplateApplicationInput], { nullable: true, description: 'Apps preinstalled on every VM from this blueprint.' })
      applications?: TemplateApplicationInput[]

    @Field(() => [TemplateScriptInput], { nullable: true, description: 'FIRST_BOOT scripts run on every VM from this blueprint.' })
      scripts?: TemplateScriptInput[]
}
