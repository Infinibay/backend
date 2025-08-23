import { ObjectType, Field, InputType, registerEnumType } from 'type-graphql'
import { SuccessType } from '../resolvers/machine/type'

export enum ServiceStatus {
  RUNNING = 'running',
  STOPPED = 'stopped',
  DISABLED = 'disabled',
  UNKNOWN = 'unknown'
}

export enum ServiceStartType {
  AUTOMATIC = 'automatic',
  MANUAL = 'manual',
  DISABLED = 'disabled',
  UNKNOWN = 'unknown'
}

export enum VMServiceAction {
  START = 'START',
  STOP = 'STOP',
  RESTART = 'RESTART',
  ENABLE = 'ENABLE',
  DISABLE = 'DISABLE',
  STATUS = 'STATUS'
}

registerEnumType(ServiceStatus, {
  name: 'ServiceStatus',
  description: 'The current status of a system service'
})

registerEnumType(ServiceStartType, {
  name: 'ServiceStartType',
  description: 'The startup type of a system service'
})

registerEnumType(VMServiceAction, {
  name: 'VMServiceAction',
  description: 'Actions that can be performed on a VM service'
})

@ObjectType()
export class ServiceInfo {
  @Field()
  name!: string

  @Field({ nullable: true })
  displayName?: string

  @Field(() => ServiceStatus)
  status!: ServiceStatus

  @Field(() => ServiceStartType, { nullable: true })
  startType?: ServiceStartType

  @Field({ nullable: true })
  description?: string

  @Field({ nullable: true })
  pid?: number
}

@InputType()
export class ServiceControlInput {
  @Field()
  machineId!: string

  @Field()
  serviceName!: string

  @Field(() => VMServiceAction)
  action!: VMServiceAction
}

@ObjectType()
export class ServiceStatusType extends SuccessType {
  @Field(() => ServiceInfo, { nullable: true })
  service?: ServiceInfo

  @Field({ nullable: true })
  error?: string
}