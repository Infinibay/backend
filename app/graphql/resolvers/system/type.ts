import { ObjectType, Field, Float } from 'type-graphql'

@ObjectType()
export class GPU {
  @Field(() => String)
    pciBus: string = ''

  @Field(() => String)
    vendor: string = ''

  @Field(() => String)
    model: string = ''

  @Field(() => Float)
    memory: number = 0

  // Whether this GPU is ready for VFIO passthrough on the host.
  // False = wizard should disable selection and show the reason.
  @Field(() => Boolean)
    passthroughReady: boolean = false

  // Human-readable reason when passthroughReady=false (e.g. "Bound to nvidia, not vfio-pci").
  @Field(() => String, { nullable: true })
    passthroughBlockedReason?: string | null
}

@ObjectType()
export class SystemResourceCPU {
  @Field(() => Float)
    total!: number

  @Field(() => Float)
    available!: number
}

@ObjectType()
export class SystemResourceMemory {
  @Field(() => Float)
    total!: number

  @Field(() => Float)
    available!: number
}

@ObjectType()
export class SystemResourceDisk {
  @Field(() => Float)
    total!: number

  @Field(() => Float)
    available!: number

  @Field(() => Float)
    used!: number
}

@ObjectType()
export class SystemResources {
  @Field(() => SystemResourceCPU)
    cpu!: SystemResourceCPU

  @Field(() => SystemResourceMemory)
    memory!: SystemResourceMemory

  @Field(() => SystemResourceDisk)
    disk!: SystemResourceDisk
}
