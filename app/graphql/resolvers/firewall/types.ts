import { ObjectType, Field, ID, InputType, registerEnumType, Int } from 'type-graphql';
import { DepartmentNWFilter } from '@prisma/client';
import { GraphQLJSONObject } from "graphql-type-json";

export enum FilterType {
  GENERIC = "generic",
  DEPARTMENT = "department",
  VM = "vm"
}

registerEnumType(FilterType, {
  name: "FilterType",
  description: "Type of network filter"
});

@ObjectType()
export class FWRule {
  @Field(() => ID)
  id: string = '';

  @Field()
  protocol: string = '';

  @Field()
  direction: string = '';

  @Field()
  action: string = '';

  @Field()
  priority: number = 0;

  //WRONG
  @Field({ nullable: true })
  ipRange?: string;

  //WRONG
  @Field({ nullable: true })
  portRange?: string;

  @Field(() => Date, {nullable: true})
  createdAt?: Date = new Date();

  @Field(() => Date, {nullable: true})
  updatedAt: Date = new Date();
}

@ObjectType()
export class GenericFilter {
  @Field(() => ID)
  id: string = '';

  @Field()
  name: string = '';

  @Field({ nullable: true })
  description?: string;

  @Field(() => FilterType)
  type: FilterType = FilterType.GENERIC;

  @Field(() => [FWRule], { nullable: true })
  rules: FWRule[] = [];

  @Field(() => [String])
  references: string[] = [];

  @Field(() => Date)
  createdAt: Date = new Date();

  @Field(() => Date)
  updatedAt: Date = new Date();
}

@ObjectType()
export class DepartmentFilter extends GenericFilter {
  @Field(() => ID)
  departmentId: string = '';

  @Field()
  priority: number = 0;
}

@ObjectType()
export class VMFilter extends GenericFilter {
  @Field(() => ID)
  vmId: string = '';

  @Field()
  priority: number = 0;
}

@InputType()
export class CreateFilterRuleInput {
  @Field(() => String)
  filterId: string = '';

  @Field(() => String)
  action: string = '';

  @Field(() => String)
  direction: string = '';

  @Field(() => Int)
  priority: number = 0;

  @Field(() => String, { nullable: true })
  protocol?: string;

  @Field(() => Int, { nullable: true })
  srcPortStart?: number;

  @Field(() => Int, { nullable: true })
  srcPortEnd?: number;

  @Field(() => Int, { nullable: true })
  dstPortStart?: number;

  @Field(() => Int, { nullable: true })
  dstPortEnd?: number;

  @Field(() => String, { nullable: true })
  comment?: string;

  @Field(() => String, { nullable: true })
  ipVersion?: string;

  @Field(() => String, { nullable: true })
  state?: string;
}

@InputType()
export class UpdateFilterRuleInput {
  @Field(() => String)
  action: string = '';

  @Field(() => String)
  direction: string = '';

  @Field(() => Int)
  priority: number = 0;

  @Field(() => String, { nullable: true })
  protocol?: string;

  @Field(() => Int, { nullable: true })
  srcPortStart?: number;

  @Field(() => Int, { nullable: true })
  srcPortEnd?: number;

  @Field(() => Int, { nullable: true })
  dstPortStart?: number;

  @Field(() => Int, { nullable: true })
  dstPortEnd?: number;

  @Field(() => String, { nullable: true })
  comment?: string;

  @Field(() => String, { nullable: true })
  ipVersion?: string;

  @Field(() => String, { nullable: true })
  state?: string;
}

@InputType()
export class CreateFilterInput {
  @Field(() => FilterType, { nullable: true })
  type: FilterType = FilterType.GENERIC;

  @Field()
  name: string = '';

  @Field(() => String)
  description: string = '';

  @Field(() => String, { nullable: true })
  chain: string = 'root';
}

@InputType()
export class UpdateFilterInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true })
  chain?: string;

  @Field({ nullable: true })
  type?: FilterType;
}
