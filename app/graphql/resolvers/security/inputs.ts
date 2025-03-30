/* eslint-disable @typescript-eslint/ban-types */
// @ts-nocheck
import { InputType, Field, ID } from "type-graphql";
import { ServiceAction } from "./types";

@InputType()
export class ToggleServiceInput {
  @Field(() => ID, { description: "Unique identifier of the service to toggle" })
  serviceId!: string;

  @Field(() => ServiceAction, { description: "Service action (USE for outbound, PROVIDE for inbound)" })
  action!: ServiceAction;

  @Field(() => Boolean, { description: "Whether to enable or disable the service" })
  enabled!: boolean;
}

@InputType()
export class ToggleVmServiceInput extends ToggleServiceInput {
  @Field(() => ID, { description: "Unique identifier of the VM" })
  vmId!: string;
}

@InputType()
export class ToggleDepartmentServiceInput extends ToggleServiceInput {
  @Field(() => ID, { description: "Unique identifier of the department" })
  departmentId!: string;
}
