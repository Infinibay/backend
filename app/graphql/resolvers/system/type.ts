import { ObjectType, Field, Float } from 'type-graphql';

@ObjectType()
export class SystemResourceCPU {
  @Field(() => Float)
  total!: number;

  @Field(() => Float)
  available!: number;
}

@ObjectType()
export class SystemResourceMemory {
  @Field(() => Float)
  total!: number;

  @Field(() => Float)
  available!: number;
}

@ObjectType()
export class SystemResourceDisk {
  @Field(() => Float)
  total!: number;

  @Field(() => Float)
  available!: number;

  @Field(() => Float)
  used!: number;
}

@ObjectType()
export class SystemResources {
  @Field(() => SystemResourceCPU)
  cpu!: SystemResourceCPU;

  @Field(() => SystemResourceMemory)
  memory!: SystemResourceMemory;

  @Field(() => SystemResourceDisk)
  disk!: SystemResourceDisk;
}