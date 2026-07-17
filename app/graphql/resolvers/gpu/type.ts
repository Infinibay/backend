import { ObjectType, Field, ID, Int, InputType } from 'type-graphql'

/**
 * A department's infinigpu virtual-GPU policy — the 7 `Department` Prisma fields
 * exposed as a cohesive object (ADR-0007 §Infinibay mapping, docs/INTEGRATION.md §3).
 * Kept separate from DepartmentType so GPU policy is its own read/write surface.
 */
@ObjectType()
export class DepartmentGpuPolicyType {
  @Field(() => ID)
    departmentId: string = ''

  @Field()
    gpuEnabled: boolean = false

  @Field(() => Int)
    vramReserveMB: number = 1024

  @Field(() => Int)
    vramCapMB: number = 4096

  @Field(() => Int)
    priorityTier: number = 2

  @Field(() => Int)
    maxConcurrentGpuVMs: number = 8

  @Field(() => Int)
    gpuTimeWeight: number = 1

  @Field(() => Int)
    submissionRateTokens: number = 50000
}

/**
 * Partial update of a department's GPU policy. Every field is optional; only
 * provided fields are written. `departmentId` selects the target.
 */
@InputType()
export class UpdateDepartmentGpuPolicyInput {
  @Field(() => ID)
    departmentId: string = ''

  @Field({ nullable: true })
    gpuEnabled?: boolean

  @Field(() => Int, { nullable: true })
    vramReserveMB?: number

  @Field(() => Int, { nullable: true })
    vramCapMB?: number

  @Field(() => Int, { nullable: true })
    priorityTier?: number

  @Field(() => Int, { nullable: true })
    maxConcurrentGpuVMs?: number

  @Field(() => Int, { nullable: true })
    gpuTimeWeight?: number

  @Field(() => Int, { nullable: true })
    submissionRateTokens?: number
}

/** Result of a GPU-attach admission attempt. */
@ObjectType()
export class GpuAttachResultType {
  @Field()
    vmId: string = ''

  @Field()
    admitted: boolean = false

  @Field(() => Int)
    weight: number = 1

  @Field(() => Int)
    vramCapMB: number = 0

  @Field(() => Int)
    vramReservedMB: number = 0

  @Field(() => Int)
    priorityTier: number = 2
}

/** Per-department admitted-VM count in the host FleetView. */
@ObjectType()
export class GpuDepartmentUsageType {
  @Field(() => ID)
    departmentId: string = ''

  @Field(() => Int)
    admittedVms: number = 0
}

/** Host-wide GPU capacity snapshot (ADR-0007 "FleetView"). */
@ObjectType()
export class GpuFleetViewType {
  @Field(() => Int)
    totalVramMB: number = 0

  @Field(() => Int)
    hostReserveMB: number = 0

  @Field(() => Int)
    vramReservedMB: number = 0

  @Field(() => Int)
    vramAvailableMB: number = 0

  @Field(() => Int)
    admittedVms: number = 0

  @Field(() => [GpuDepartmentUsageType])
    byDepartment: GpuDepartmentUsageType[] = []
}
