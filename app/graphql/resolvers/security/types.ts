/* eslint-disable @typescript-eslint/ban-types */
// @ts-nocheck
import { ObjectType, Field, ID, registerEnumType } from "type-graphql";
import { ServiceDefinition as ServiceDefConfig, ServiceRiskLevel, ServicePort as ServicePortConfig } from '../../../config/knownServices';

// Register enums
export enum ServiceAction {
  USE = "use",
  PROVIDE = "provide"
}
registerEnumType(ServiceAction, { name: "ServiceAction", description: "Service action type (USE for outbound, PROVIDE for inbound)" });

registerEnumType(ServiceRiskLevel, { name: "ServiceRiskLevel", description: "Risk level of a service" });

@ObjectType()
export class ServicePort implements ServicePortConfig {
  @Field(() => String, { description: "Protocol (TCP or UDP)" })
  protocol!: string;

  @Field(() => Number, { description: "Starting port number" })
  portStart!: number;

  @Field(() => Number, { description: "Ending port number" })
  portEnd!: number;
}

@ObjectType()
export class ServiceDefinition implements ServiceDefConfig {
  @Field(() => ID, { description: "Unique identifier for the service" })
  id!: string;

  @Field(() => String, { description: "Internal name of the service" })
  name!: string;

  @Field(() => String, { description: "Human-readable name of the service" })
  displayName!: string;

  @Field(() => String, { description: "Description of the service" })
  description!: string;

  @Field(() => ServiceRiskLevel, { description: "Risk level of the service" })
  riskLevel!: ServiceRiskLevel;

  @Field(() => String, { description: "Description of the risk" })
  riskDescription!: string;

  @Field(() => [ServicePort], { description: "Port configurations for the service" })
  ports!: ServicePort[];
}

@ObjectType()
export class VmServiceStatus {
  @Field(() => ID, { description: "Unique identifier for the VM" })
  vmId!: string;

  @Field(() => String, { description: "Name of the VM" })
  vmName!: string;

  @Field(() => ID, { description: "Unique identifier for the service" })
  serviceId!: string;

  @Field(() => String, { description: "Name of the service" })
  serviceName!: string;

  @Field(() => Boolean, { description: "Whether the service is enabled for outbound traffic" })
  useEnabled!: boolean;

  @Field(() => Boolean, { description: "Whether the service is enabled for inbound traffic" })
  provideEnabled!: boolean;

  @Field(() => Boolean, { description: "Whether the service is currently running" })
  running!: boolean;

  @Field(() => Date, { nullable: true, description: "When the service was last seen running" })
  lastSeen?: Date;
}

@ObjectType()
export class VmServiceStatusWithService extends VmServiceStatus {
  @Field(() => ServiceDefinition, { description: "Service definition details" })
  service!: ServiceDefinition;
}

@ObjectType()
export class DepartmentServiceStatus {
  @Field(() => ID, { description: "Unique identifier for the department" })
  departmentId!: string;

  @Field(() => String, { description: "Name of the department" })
  departmentName!: string;

  @Field(() => ID, { description: "Unique identifier for the service" })
  serviceId!: string;

  @Field(() => String, { description: "Name of the service" })
  serviceName!: string;

  @Field(() => Boolean, { description: "Whether the service is enabled for outbound traffic" })
  useEnabled!: boolean;

  @Field(() => Boolean, { description: "Whether the service is enabled for inbound traffic" })
  provideEnabled!: boolean;

  @Field(() => Number, { description: "Total number of VMs in the department" })
  vmCount!: number;

  @Field(() => Number, { description: "Number of VMs in the department with this service enabled" })
  enabledVmCount!: number;
}

@ObjectType()
export class DepartmentServiceStatusWithService extends DepartmentServiceStatus {
  @Field(() => ServiceDefinition, { description: "Service definition details" })
  service!: ServiceDefinition;
}

@ObjectType()
export class GlobalServiceStatus {
  @Field(() => ID, { description: "Unique identifier for the service" })
  serviceId!: string;

  @Field(() => String, { description: "Name of the service" })
  serviceName!: string;

  @Field(() => Boolean, { description: "Whether the service is enabled for outbound traffic" })
  useEnabled!: boolean;

  @Field(() => Boolean, { description: "Whether the service is enabled for inbound traffic" })
  provideEnabled!: boolean;
}

@ObjectType()
export class GlobalServiceStatusWithService extends GlobalServiceStatus {
  @Field(() => ServiceDefinition, { description: "Service definition details" })
  service!: ServiceDefinition;
}

@ObjectType()
export class ServiceStatusSummary {
  @Field(() => ID, { description: "Unique identifier for the service" })
  serviceId!: string;

  @Field(() => String, { description: "Name of the service" })
  serviceName!: string;

  @Field(() => Number, { description: "Total number of VMs" })
  totalVms!: number;

  @Field(() => Number, { description: "Number of VMs with this service running" })
  runningVms!: number;

  @Field(() => Number, { description: "Number of VMs with this service enabled" })
  enabledVms!: number;
}
