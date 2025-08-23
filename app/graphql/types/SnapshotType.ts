import { ObjectType, Field, ID, InputType } from 'type-graphql';

@ObjectType()
export class Snapshot {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field({ nullable: true })
  description?: string;

  @Field()
  vmId!: string;

  @Field()
  vmName!: string;

  @Field()
  createdAt!: Date;

  @Field()
  isCurrent!: boolean;

  @Field({ nullable: true })
  parentId?: string;

  @Field()
  hasMetadata!: boolean;

  @Field(() => String)
  state!: string;
}

@InputType()
export class CreateSnapshotInput {
  @Field()
  machineId!: string;

  @Field()
  name!: string;

  @Field({ nullable: true })
  description?: string;
}

@InputType()
export class RestoreSnapshotInput {
  @Field()
  machineId!: string;

  @Field()
  snapshotName!: string;
}

@InputType()
export class DeleteSnapshotInput {
  @Field()
  machineId!: string;

  @Field()
  snapshotName!: string;
}

@ObjectType()
export class SnapshotResult {
  @Field()
  success!: boolean;

  @Field()
  message!: string;

  @Field(() => Snapshot, { nullable: true })
  snapshot?: Snapshot;
}

@ObjectType()
export class SnapshotListResult {
  @Field()
  success!: boolean;

  @Field()
  message!: string;

  @Field(() => [Snapshot])
  snapshots!: Snapshot[];
}